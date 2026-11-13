#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""英语学习的语音生成：微软 Edge 的神经网络语音（edge-tts）→ mp3 → 写进 D1 的 en_audio。

为什么是它（Amos 2026-11-13 的原话，这里照搬他已有的做法）
---------------------------------------------------------
用的是微软 Edge 浏览器「大声朗读」背后的**神经网络语音（Neural TTS）**：
英文 Sonia（en-GB-SoniaNeural，英国女声），中文 晓晓（zh-CN-XiaoxiaoNeural，他听过试音确认）。
它是用真人录音训练出来的，语气和停顿比手机自带的朗读自然很多 —— **他嫌手机朗读太机械**。
语速一律慢 5%，方便跟读。每条的**键 = 内容的哈希**，所以同一句只生成一次；
以后加新句子，只补新的那几句。

**mp3 不进仓库**（Amos 2026-11-13 定的 A 方案）：两个仓库都是 public，里面念的是第三方课程内容。
生成好的字节直接写进 D1 的 `en_audio`（迁移 0022），仓库里一个 .mp3 都没有。

**不新增任何密钥**（底线 1）：edge-tts 是免费的开源工具，不需要密钥；
写回 D1 用的是已经有的 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID。

装它
----
    pip install edge-tts          # 7.3.1 实测可用

⚠️ **代理的根证书**（换一台机器最容易卡在这里）：
有些环境（这台机器、公司网络）的 HTTPS 走中间代理，Python 的 certifi 里没有那张根证书，
不补就是 `SSLCertVerificationError: self-signed certificate in certificate chain`。
**这个脚本自己会补**：看到 /root/.ccr/ca-bundle.crt（或环境变量 EXTRA_CA_BUNDLE 指的文件）就把它
加进 edge-tts 用的那个 SSL 上下文（只在本进程里加，不改系统文件，重复跑也没事）。
手工补的办法（等价）：
    cat /root/.ccr/ca-bundle.crt >> "$(python3 -c 'import certifi;print(certifi.where())')"
**绝不关掉证书校验。**

怎么跑
------
    python3 scripts/build-audio.py --out /tmp/试听            # 只生成到文件夹，不碰数据库（先听听看）
    python3 scripts/build-audio.py --check --env staging      # 只看差多少条，不生成
    python3 scripts/build-audio.py --env staging              # 补齐测试版 D1 里缺的那些
    python3 scripts/build-audio.py --env production           # 补齐正式版
    python3 scripts/build-audio.py --env staging --only s2    # 只补一部分（按「来自」里的字）
    python3 scripts/build-audio.py --env staging --limit 10   # 这次最多补 10 条

**失败的那几句会逐条列出来，不会整个崩掉**（底线 9）：一句念不出来就记一笔接着念下一句，
最后打印「成功 N 条 / 失败 K 条」并以非 0 退出，让 CI 红给你看，不许悄悄过去。

要念哪些句子不在这里手抄：`node_modules/.bin/vite-node scripts/audio-manifest.ts` 打印那份清单
（它读 src/en-audio-list.ts → pron-content / pron-lesson / s2-lesson）。**哈希只有一处实现**
（src/en-audio.ts 的 audioKey），Python 这边不自己算，免得两边算出不一样的键。
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VITE_NODE = ROOT / "node_modules" / ".bin" / "vite-node"
MANIFEST_TS = "scripts/audio-manifest.ts"
DB_NAMES = {"staging": "marketing-staging", "production": "marketing"}
WRANGLER_ENV = {"staging": "staging", "production": ""}
# 代理的根证书：这台机器放在这里；别的环境用 EXTRA_CA_BUNDLE 指过去
CA_CANDIDATES = [os.environ.get("EXTRA_CA_BUNDLE", ""), "/root/.ccr/ca-bundle.crt"]
KEY_RE = re.compile(r"^e\d+-[0-9a-f]{16}$")


def 说(s: str) -> None:
    print(s, flush=True)


# ----------------------------------------------------------------------
# 一、清单（唯一的真相在 TypeScript 那边）
# ----------------------------------------------------------------------
def 读清单() -> list[dict]:
    if not VITE_NODE.exists():
        raise SystemExit(f"✗ 找不到 {VITE_NODE}（先在仓库根目录跑一次 npm ci）")
    out = subprocess.run([str(VITE_NODE), MANIFEST_TS], cwd=ROOT, capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit(f"✗ 取清单失败（{MANIFEST_TS}）：\n{out.stderr.strip()[:2000]}")
    data = json.loads(out.stdout[out.stdout.index("{"):])
    清单 = data["清单"]
    for x in 清单:
        if not KEY_RE.match(x["键"]):
            raise SystemExit(f"✗ 清单里有个键不像键：{x['键']}")
    说(f"· 清单：{len(清单)} 条（语速 {data['语速']}，声音 {('、'.join(data['声音们']))}）")
    return 清单


# ----------------------------------------------------------------------
# 二、D1：先查已经有哪些键，只补缺的
# ----------------------------------------------------------------------
def 准备配置(env: str) -> None:
    """和 scripts/deploy.sh 一样：先让 ensure-d1.mjs 把 database_id 写进 wrangler.deploy.toml。"""
    r = subprocess.run(["node", "scripts/ensure-d1.mjs", "--env", env], cwd=ROOT)
    if r.returncode != 0:
        raise SystemExit("✗ 准备 D1 配置失败（ensure-d1.mjs）")


def wrangler_d1(env: str, args: list[str]) -> str:
    cmd = ["npx", "wrangler", "d1", "execute", DB_NAMES[env], "--remote", "-c", "wrangler.deploy.toml",
           f"--env={WRANGLER_ENV[env]}", "-y", *args]
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True,
                       env={**os.environ, "WRANGLER_SEND_METRICS": "false"})
    if r.returncode != 0:
        raise SystemExit(f"✗ D1 执行失败：\n{(r.stdout + r.stderr).strip()[:2000]}")
    return r.stdout


def 库里已有的键(env: str) -> set[str]:
    out = wrangler_d1(env, ["--json", "--command", "SELECT k FROM en_audio"])
    i = out.find("[")
    if i < 0:
        raise SystemExit("✗ 查 en_audio 没有返回 JSON（表还没建？部署一次就会跑迁移 0022）")
    data = json.loads(out[i:])
    行 = []
    for 块 in data if isinstance(data, list) else [data]:
        行 += (块 or {}).get("results", []) or []
    return {r["k"] for r in 行 if r.get("k")}


def 写进D1(env: str, 批: list[tuple[dict, bytes]]) -> None:
    """一批写一次。mp3 用 SQLite 的十六进制字面量 X'…' 传（D1 没有别的办法塞 BLOB）。"""
    sql = []
    for 条, mp3 in 批:
        文 = 条["文"].replace("'", "''")
        sql.append(
            "INSERT INTO en_audio (k, voice, txt, mp3, bytes, at) VALUES "
            f"('{条['键']}', '{条['声音']}', '{文}', X'{mp3.hex()}', {len(mp3)}, {int(time.time() * 1000)}) "
            "ON CONFLICT (k) DO UPDATE SET voice = excluded.voice, txt = excluded.txt, "
            "mp3 = excluded.mp3, bytes = excluded.bytes, at = excluded.at;"
        )
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8") as f:
        f.write("\n".join(sql))
        路径 = f.name
    try:
        wrangler_d1(env, ["--file", 路径])
    finally:
        os.unlink(路径)


# ----------------------------------------------------------------------
# 三、生成（edge-tts）
# ----------------------------------------------------------------------
def 补根证书() -> str | None:
    """把代理的根证书加进 edge-tts 用的那个 SSL 上下文。只在本进程里加，不改系统文件。"""
    import edge_tts.communicate as C

    for p in CA_CANDIDATES:
        if p and Path(p).exists():
            C._SSL_CTX.load_verify_locations(cafile=p)  # noqa: SLF001  上游没给公开入口，只能这样补
            return p
    return None


async def 念一句(文: str, 声音: str, 语速: str, 代理: str | None) -> bytes:
    import edge_tts

    c = edge_tts.Communicate(文, 声音, rate=语速, proxy=代理)
    buf = bytearray()
    async for chunk in c.stream():
        if chunk["type"] == "audio":
            buf += chunk["data"]
    if not buf:
        raise RuntimeError("微软那边一个字节都没回")
    return bytes(buf)


# ----------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser(description="英语学习的语音生成（edge-tts → D1 en_audio）")
    ap.add_argument("--env", choices=sorted(DB_NAMES), help="写进哪个 D1；不给就只生成不写库（要配 --out）")
    ap.add_argument("--out", help="把 mp3 另存一份到这个文件夹（试听用；**别放进仓库**）")
    ap.add_argument("--check", action="store_true", help="只报还缺几条，不生成")
    ap.add_argument("--only", default="", help="只做「来自」里带这几个字的那些（例如 s2 / pron-content / g1）")
    ap.add_argument("--limit", type=int, default=0, help="这次最多做几条（0 = 不限）")
    ap.add_argument("--batch", type=int, default=1, help="一次往 D1 写几条（默认 1，稳；条数多可以调大）")
    ap.add_argument("--rate", default="", help="覆盖语速（默认用清单里的 -5%%，别乱改：改了键全变）")
    a = ap.parse_args()

    if not a.env and not a.out and not a.check:
        说("要么 --env（写库），要么 --out（只生成到文件夹），要么 --check（只看差多少）。")
        return 2

    清单 = 读清单()
    data_rate = a.rate or "-5%"
    if a.only:
        清单 = [x for x in 清单 if a.only in x["来自"]]
        说(f"· --only {a.only} → 剩 {len(清单)} 条")

    已有: set[str] = set()
    if a.env:
        准备配置(a.env)
        已有 = 库里已有的键(a.env)
        说(f"· {DB_NAMES[a.env]} 里已经有 {len(已有)} 条")
    缺 = [x for x in 清单 if x["键"] not in 已有]
    说(f"· 要补 {len(缺)} 条")
    if a.check:
        for x in 缺[:20]:
            说(f"    缺 {x['键']}  {x['来自']}  {x['文'][:30]}")
        if len(缺) > 20:
            说(f"    …… 还有 {len(缺) - 20} 条")
        return 0
    if a.limit:
        缺 = 缺[: a.limit]
        说(f"· --limit {a.limit} → 这次做 {len(缺)} 条")
    if not 缺:
        说("✓ 一条都不缺，什么都没做。")
        return 0

    ca = 补根证书()
    说(f"· 代理根证书：{ca or '没找到，按系统默认走'}")
    代理 = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy") or None
    目录 = Path(a.out).resolve() if a.out else None
    if 目录:
        目录.mkdir(parents=True, exist_ok=True)
        说(f"· mp3 另存到 {目录}（**不进仓库**）")

    成了: list[tuple[dict, bytes]] = []
    失败: list[tuple[dict, str]] = []
    批: list[tuple[dict, bytes]] = []
    for n, 条 in enumerate(缺, 1):
        try:
            mp3 = asyncio.run(念一句(条["文"], 条["声音"], data_rate, 代理))
        except Exception as e:  # 一句念不出来就记一笔接着念下一句，**不整个崩掉**
            失败.append((条, f"{type(e).__name__}: {e}"))
            说(f"  ✗ {n}/{len(缺)} {条['键']}  {条['来自']}  —— {type(e).__name__}: {str(e)[:120]}")
            continue
        说(f"  ✓ {n}/{len(缺)} {条['键']}  {len(mp3)} 字节  {条['来自']}  {条['文'][:24]}")
        成了.append((条, mp3))
        if 目录:
            (目录 / f"{条['键']}.mp3").write_bytes(mp3)
        if a.env:
            批.append((条, mp3))
            if len(批) >= max(1, a.batch):
                写进D1(a.env, 批)
                批 = []
    if a.env and 批:
        写进D1(a.env, 批)

    说("")
    说(f"成功 {len(成了)} 条，失败 {len(失败)} 条" + (f"，已写进 {DB_NAMES[a.env]}" if a.env else "，没有写库"))
    for 条, why in 失败:
        说(f"  失败：{条['键']}  {条['来自']}  {条['文'][:40]}  —— {why}")
    return 1 if 失败 else 0


if __name__ == "__main__":
    sys.exit(main())

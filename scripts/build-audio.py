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

**一条音频拆成多行存**（2026-11-13，线上 `statement too long: SQLITE_TOOBIG`）：
mp3 进 D1 只能写成十六进制字面量 X'…'，**字符数是字节数的两倍**，最大那条 83,232 字节
→ 166,464 个字符 ≈ 166 KB，超过 D1 **单条 SQL 100 KB** 的上限（`--batch` 本来就是 1，
不是批太大，是单条本身就超）。所以字节按 30,000 字节一块切开写进 `en_audio_part`（迁移 0023），
`en_audio` 只留元数据、`mp3` 列写空；读的时候 src/en-audio.ts 按 part 顺序拼回去。

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
# 一条音频切成几块写（迁移 0023 的 en_audio_part）：每块最多这么多字节。
# 十六进制字面量的字符数是字节数的两倍，所以 30,000 字节 = 60,000 个字符，离 D1 单条 100 KB 的上限很远。
每块字节 = 30_000
# D1 单条 SQL 的上限（超过就是线上那条 `statement too long: SQLITE_TOOBIG`）。只用来自检，不是配置。
D1单条上限 = 100_000


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


def 切块(mp3: bytes) -> list[bytes]:
    """一条音频切成几块，每块不超过 每块字节（空的回空列表）。"""
    return [mp3[i:i + 每块字节] for i in range(0, len(mp3), 每块字节)]


def 一条的SQL(条: dict, mp3: bytes, 时刻: int) -> list[str]:
    """一条音频 → 几条**各自独立**的 SQL（调用方一条一行写进文件，任何一条都远低于 100 KB）。

    顺序是固定的三段：
      ① 先把这个键的旧块全删掉 —— **重跑一遍结果一样**（上次写到一半断了也不会留下半截）；
      ② 一条元数据进 en_audio（念的是哪一句、多大、什么时候写的）；**mp3 列写空 X''**，
         字节在分块表里（那一列留着不删，见迁移 0023）；
      ③ 每块一条 INSERT 进 en_audio_part，part 从 0 开始。
    """
    k, 声音 = 条["键"], 条["声音"]
    文 = 条["文"].replace("'", "''")
    # 「每条语句单独一行」是这套写法的前提（一行一条，谁都不会被别的语句带长）。
    # 真有一句带换行的，**当场说出来**，不许悄悄写进去（底线 9）。这一版 190 条一条都没有。
    if "\n" in 文 or "\r" in 文:
        raise SystemExit(f"✗ 这一句里有换行，SQL 就不是一行一条了：{k}")
    sql = [f"DELETE FROM en_audio_part WHERE k = '{k}';"]
    sql.append(
        "INSERT INTO en_audio (k, voice, txt, mp3, bytes, at) VALUES "
        f"('{k}', '{声音}', '{文}', X'', {len(mp3)}, {时刻}) "
        "ON CONFLICT (k) DO UPDATE SET voice = excluded.voice, txt = excluded.txt, "
        "mp3 = excluded.mp3, bytes = excluded.bytes, at = excluded.at;"
    )
    for i, 块 in enumerate(切块(mp3)):
        sql.append(f"INSERT INTO en_audio_part (k, part, mp3) VALUES ('{k}', {i}, X'{块.hex()}');")
    for s in sql:
        if len(s.encode()) > D1单条上限:
            raise SystemExit(f"✗ 生成出来的这条 SQL 有 {len(s.encode())} 字节，超过 D1 的 {D1单条上限}（{k}）—— 把 每块字节 调小")
    return sql


def 写进D1(env: str, 批: list[tuple[dict, bytes]]) -> None:
    """一批（几条音频）写一次。每条音频拆成多行，**每条 SQL 语句单独一行、互相独立**。

    mp3 要进 D1 只能写成十六进制字面量 X'…'（没有别的办法塞 BLOB），而**字符数是字节数的两倍**：
    2026-11-13 线上最大那条 83,232 字节 → 166,464 个字符 ≈ 166 KB，一条 INSERT 就超过 D1
    **单条 SQL 100 KB** 的上限，报 `statement too long: SQLITE_TOOBIG`，生成任务写第一条就挂。
    所以这里按 每块字节（30,000 字节 → 60,000 个字符）切开，一块一条 INSERT 进 en_audio_part。
    """
    sql: list[str] = []
    时刻 = int(time.time() * 1000)
    for 条, mp3 in 批:
        sql += 一条的SQL(条, mp3, 时刻)
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8") as f:
        f.write("\n".join(sql) + "\n")
        路径 = f.name
    try:
        wrangler_d1(env, ["--file", 路径])
    finally:
        os.unlink(路径)


# ----------------------------------------------------------------------
# 三、生成（edge-tts）
# ----------------------------------------------------------------------
def 补根证书() -> str | None:
    """把代理的根证书加进 edge-tts 用的那个 SSL 上下文。只在本进程里加，不改系统文件。

    **读不到就当没有，不许让整个脚本崩。** 这张证书只有「HTTPS 走中间代理」的环境才需要
    （开发容器）；GitHub Actions 的机器直连外网，根本没有这个文件，而且候选路径里有
    /root/.ccr/ca-bundle.crt —— 跑 CI 的不是 root，连 stat 都会抛
    `PermissionError: [Errno 13] Permission denied`（2026-11-13 线上第一次生成就是这么崩的）。
    所以这里把**所有**读取异常都吞掉，拿不到就返回 None，让 edge-tts 用系统默认的证书走。
    """
    import edge_tts.communicate as C

    for p in CA_CANDIDATES:
        if not p:
            continue
        try:
            if not Path(p).exists():
                continue
            C._SSL_CTX.load_verify_locations(cafile=p)  # noqa: SLF001  上游没给公开入口，只能这样补
            return p
        except OSError:
            continue  # 没权限 / 读不了 / 不是证书 —— 都当没有这张证书
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
    ap.add_argument("--batch", type=int, default=1, help="一次提交几条音频（默认 1，稳；条数多可以调大。**和单条 SQL 多长无关**：每条音频本来就拆成多行写）")
    ap.add_argument("--sql", help="【只给测试用】把这个 mp3 文件按真的那套切块规则生成 SQL 打印出来，不连网、不写库（配 --key）")
    ap.add_argument("--key", default="", help="配合 --sql：这条音频的键（页面算出来的那个 e1-… ）")
    ap.add_argument("--voice", default="en-GB-SoniaNeural", help="配合 --sql：哪个声音念的")
    ap.add_argument("--txt", default="", help="配合 --sql：念的那一句")
    ap.add_argument("--rate", default="", help="覆盖语速（默认用清单里的 -5%%，别乱改：改了键全变）")
    a = ap.parse_args()

    # --sql：只把 SQL 打出来（test/en-audio.test.ts 用它验「最大那条也能逐字节原样读回来」）。
    # 切块的规则**只有上面那一处**，测试走的就是线上走的那段代码，不另抄一份。
    if a.sql:
        if not KEY_RE.match(a.key):
            说("--sql 要配 --key <e1-…>（键由 src/en-audio.ts 的 audioKey 算，这边不自己算）")
            return 2
        for s in 一条的SQL({"键": a.key, "声音": a.voice, "文": a.txt}, Path(a.sql).read_bytes(), int(time.time() * 1000)):
            print(s)
        return 0

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

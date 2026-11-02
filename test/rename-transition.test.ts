/**
 * 改名过渡期（"公司平台"→"工作平台"，Amos 2026-11-02）：上线顺序是 Marketing 先上、agents 改名后合，
 * 所以这段时间 agents 推来的状态卡 key 和"见…"标记可能还是旧字样。服务端的对照表和页面（同一份 PLATFORM_CONFIG 原样插进页面脚本）要新旧都认。
 * 研发新增（批 3 审查后），不改别人的断言。
 */
import { describe, expect, it } from 'vitest';
import { ADMIN_PAGE } from '../src/admin-page';
import { isToolCard, NOT_PROJECTS, PLATFORM_CONFIG, SEE_PLATFORM, seesPlatform } from '../src/projects';

describe('改名过渡期：新旧字样都认', () => {
  it('状态卡 key"工作平台"和旧的"公司平台"都算工具层（项目概况、一级菜单不列），页面拿到的是同一份名单', () => {
    expect(isToolCard('工作平台')).toBe(true);
    expect(isToolCard('公司平台')).toBe(true);
    expect(isToolCard('forecast')).toBe(false);
    expect(PLATFORM_CONFIG.NOT_PROJECTS).toBe(NOT_PROJECTS);
    expect(ADMIN_PAGE).toContain(JSON.stringify(NOT_PROJECTS));
  });

  it('状态卡里写"见工作平台"或旧的"见公司平台"都换成平台里的值；页面按同一份标记判断', () => {
    expect(seesPlatform('见工作平台')).toBe(true);
    expect(seesPlatform('见公司平台')).toBe(true);
    expect(seesPlatform('17（见工作平台）')).toBe(true);
    expect(seesPlatform('17')).toBe(false);
    expect(seesPlatform(undefined)).toBe(false);
    expect(ADMIN_PAGE).toContain(JSON.stringify(SEE_PLATFORM));
    expect(ADMIN_PAGE).toMatch(/CFG\.SEE_PLATFORM\.some\(/);
  });
});

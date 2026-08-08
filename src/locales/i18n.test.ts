import { describe, it, expect } from "vitest";
import { zh } from "./zh";
import { en } from "./en";

// 递归收集对象的所有点分路径 key
function collectKeys(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object") return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object") {
      out.push(...collectKeys(v, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

// 按点分路径取值，找不到返回 undefined
function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in cur) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

describe("i18n 完整性", () => {
  const zhKeys = collectKeys(zh).sort();
  const enKeys = collectKeys(en).sort();

  it("zh 与 en 的 key 数量一致", () => {
    expect(zhKeys.length).toBe(enKeys.length);
  });

  it("zh 的每个 key 在 en 中都存在", () => {
    for (const k of zhKeys) {
      expect(enKeys, `en 缺少 key: ${k}`).toContain(k);
    }
  });

  it("en 的每个 key 在 zh 中都存在", () => {
    for (const k of enKeys) {
      expect(zhKeys, `zh 缺少 key: ${k}`).toContain(k);
    }
  });

  it("每个 key 在 zh 与 en 中类型一致（同为 string 或同为 object）", () => {
    for (const k of zhKeys) {
      const z = getByPath(zh, k);
      const e = getByPath(en, k);
      // 只校验叶子节点（string），非 string 的已在 collectKeys 中跳过
      if (typeof z === "string" && typeof e === "string") {
        // ok
      } else if (typeof z !== typeof e) {
        throw new Error(`类型不一致: ${k} (zh=${typeof z}, en=${typeof e})`);
      }
    }
  });

  // Round 17 修订计划新增的 key 必须存在
  describe("Round 17 新增 key", () => {
    const requiredMenuKeys = [
      "menu.layout",
      "menu.layoutHorizontal",
      "menu.layoutVertical",
      "menu.autoHidePanel",
      "menu.fontInc",
      "menu.fontDec",
      "menu.fontReset",
      "menu.togglePanel",
      "menu.help",
      "menu.helpContent",
      "menu.undo",
      "menu.redo",
      "menu.cut",
      "menu.copy",
      "menu.paste",
      "menu.selectAll",
      "menu.toggleDevtools",
      "menu.about",
    ];
    const requiredAboutKeys = [
      "about.version",
      "about.author",
      "about.license",
      "about.copyright",
      "about.website",
    ];
    const requiredSettingsKeys = [
      "settings.shortcuts",
      "settings.shortcutCategory",
      "settings.shortcutAction",
      "settings.shortcutKey",
      "settings.shortcutFile",
      "settings.shortcutEdit",
      "settings.shortcutFind",
      "settings.shortcutView",
      "settings.shortcutRun",
      "settings.shortcutApp",
      "settings.testSettings",
      "settings.testTimeLimit",
      "settings.testTimeLimitHint",
      "settings.colorBg",
      "settings.colorPanel",
      "settings.colorPrimary",
      "settings.colorText",
      "settings.colorBorder",
      "settings.resetColors",
    ];

    it.each(requiredMenuKeys)("zh 与 en 都包含 %s", (k) => {
      expect(getByPath(zh, k), `zh 缺少 ${k}`).toBeTypeOf("string");
      expect(getByPath(en, k), `en 缺少 ${k}`).toBeTypeOf("string");
    });

    it.each(requiredSettingsKeys)("zh 与 en 都包含 %s", (k) => {
      expect(getByPath(zh, k), `zh 缺少 ${k}`).toBeTypeOf("string");
      expect(getByPath(en, k), `en 缺少 ${k}`).toBeTypeOf("string");
    });

    it.each(requiredAboutKeys)("zh 与 en 都包含 %s", (k) => {
      expect(getByPath(zh, k), `zh 缺少 ${k}`).toBeTypeOf("string");
      expect(getByPath(en, k), `en 缺少 ${k}`).toBeTypeOf("string");
    });
  });

  // Round 17 已删除的 zoom key 不应再存在
  describe("Round 17 已删除 key", () => {
    it.each(["menu.zoomIn", "menu.zoomOut", "menu.zoomReset"])(
      "%s 应已从 zh 与 en 中删除",
      (k) => {
        expect(getByPath(zh, k)).toBeUndefined();
        expect(getByPath(en, k)).toBeUndefined();
      },
    );
  });

  // 速查表扩充（6 大分类：io/syntax/stl/algorithm/dp/graph）新增的类别 key
  describe("cheatsheet 类别 key", () => {
    const requiredCheatsheetKeys = [
      "cheatsheet.catAll",
      "cheatsheet.catSyntax",
      "cheatsheet.catIO",
      "cheatsheet.catSTL",
      "cheatsheet.catCommonAlgorithm",
      "cheatsheet.catDP",
      "cheatsheet.catGraph",
    ];

    it.each(requiredCheatsheetKeys)("zh 与 en 都包含 %s", (k) => {
      expect(getByPath(zh, k), `zh 缺少 ${k}`).toBeTypeOf("string");
      expect(getByPath(en, k), `en 缺少 ${k}`).toBeTypeOf("string");
    });
  });

  // 速查表重组后已删除的旧分类 key 不应再存在
  describe("cheatsheet 已删除的旧分类 key", () => {
    it.each([
      "cheatsheet.catString",
      "cheatsheet.catContainer",
      "cheatsheet.catAlgorithm",
      "cheatsheet.catTemplate",
    ])("%s 应已从 zh 与 en 中删除", (k) => {
      expect(getByPath(zh, k)).toBeUndefined();
      expect(getByPath(en, k)).toBeUndefined();
    });
  });

  // P1-4: Windows JobObject 降级感知新增的 i18n key
  describe("JobObject 降级警告 key", () => {
    it.each(["status.jobObjectDegraded"])("zh 与 en 都包含 %s", (k) => {
      expect(getByPath(zh, k), `zh 缺少 ${k}`).toBeTypeOf("string");
      expect(getByPath(en, k), `en 缺少 ${k}`).toBeTypeOf("string");
    });
  });

  // 控制流图（CFG）功能新增的 i18n key
  describe("CFG 控制流图 key", () => {
    const requiredFlowchartKeys = [
      "panel.flowchart",
      "panel.flowchartLoading",
      "panel.flowchartError",
      "panel.flowchartNoFunction",
      "panel.flowchartNoCode",
      "panel.flowchartWarning",
      "panel.flowchartRefresh",
      "panel.flowchartZoomIn",
      "panel.flowchartZoomOut",
      "panel.flowchartZoomReset",
    ];

    it.each(requiredFlowchartKeys)("zh 与 en 都包含 %s", (k) => {
      expect(getByPath(zh, k), `zh 缺少 ${k}`).toBeTypeOf("string");
      expect(getByPath(en, k), `en 缺少 ${k}`).toBeTypeOf("string");
    });
  });
});

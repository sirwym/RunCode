import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// NLS 适配模块在模块加载时读取一次 cppteach:locale 并缓存。
// 因此测试不同语言模式需要 vi.resetModules + 重新动态导入。

const STORAGE_KEY = "cppteach:locale";

// 辅助：设置 localStorage 并重新导入 nls 模块
async function importNlsWithLocale(locale: "zh" | "en" | null) {
  vi.resetModules();
  if (locale === null) {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, locale);
  }
  return import("./nls");
}

// 辅助：在无 localStorage 环境下重新导入 nls 模块（模拟 Worker）
async function importNlsWithoutLocalStorage() {
  vi.resetModules();
  const original = (globalThis as unknown as { localStorage?: Storage }).localStorage;
  // 临时移除 localStorage
  Object.defineProperty(globalThis, "localStorage", {
    value: undefined,
    configurable: true,
    writable: true,
  });
  try {
    return await import("./nls");
  } finally {
    // 恢复
    Object.defineProperty(globalThis, "localStorage", {
      value: original,
      configurable: true,
      writable: true,
    });
  }
}

describe("Monaco NLS 适配模块 — 中文模式", () => {
  let nls: typeof import("./nls");

  beforeEach(async () => {
    nls = await importNlsWithLocale("zh");
  });

  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it("字符串 key 返回中文翻译", () => {
    expect(nls.localize("undo", "Undo")).toBe("撤销");
    expect(nls.localize("actions.clipboard.cutLabel", "Cut")).toBe("剪切");
    expect(nls.localize("actions.clipboard.copyLabel", "Copy")).toBe("复制");
    expect(nls.localize("actions.clipboard.pasteLabel", "Paste")).toBe("粘贴");
  });

  it("{ key, comment } 形式返回中文翻译", () => {
    expect(
      nls.localize({ key: "miUndo", comment: ["&& denotes a mnemonic"] }, "&&Undo")
    ).toBe("撤销");
    expect(
      nls.localize({ key: "miRedo", comment: ["&& denotes a mnemonic"] }, "&&Redo")
    ).toBe("重做");
    expect(
      nls.localize({ key: "miFind", comment: ["&& denotes a mnemonic"] }, "&&Find")
    ).toBe("查找");
  });

  it("参数占位符 {0} {1} 正确替换", () => {
    expect(
      nls.localize("findMatchAction.inputPlaceHolder", "Type a number...{0}", 42)
    ).toBe("输入数字以转到特定匹配项（1 到 42）");
    expect(
      nls.localize("label.matchesLocation", "{0} of {1}", 3, 10)
    ).toBe("3 / 10");
    expect(
      nls.localize("cursorAdded", "Cursor added: {0}", 5)
    ).toBe("已添加光标: 5");
  });

  it("未知 key 回退到英文 fallback（不返回空串或 key）", () => {
    expect(nls.localize("nonexistent.key", "English Fallback")).toBe("English Fallback");
    expect(nls.localize("another.unknown", "Another {0}", "arg")).toBe("Another arg");
  });

  it("中文字典值和未知 key 回退值均不为空字符串", () => {
    // 已收录 key
    expect(nls.localize("undo", "Undo")).not.toBe("");
    expect(nls.localize("comment.line", "Toggle Line Comment")).not.toBe("");
    expect(nls.localize("label.noResults", "No results")).not.toBe("");
    // 未知 key
    expect(nls.localize("no.such.key", "Not Empty")).not.toBe("");
  });

  it("getNLSLanguage 返回 zh", () => {
    expect(nls.getNLSLanguage()).toBe("zh");
  });
});

describe("Monaco NLS 适配模块 — localize2", () => {
  let nls: typeof import("./nls");

  beforeEach(async () => {
    nls = await importNlsWithLocale("zh");
  });

  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it("localize2 中文模式：value 为中文，original 为英文", () => {
    const result = nls.localize2("undo", "Undo");
    expect(result.value).toBe("撤销");
    expect(result.original).toBe("Undo");
  });

  it("localize2 中文模式：带参数的 value 和 original 均正确替换", () => {
    const result = nls.localize2("label.matchesLocation", "{0} of {1}", 3, 10);
    expect(result.value).toBe("3 / 10");
    expect(result.original).toBe("3 of 10");
  });

  it("localize2 未知 key：value 和 original 均为英文", () => {
    const result = nls.localize2("unknown.key", "Fallback {0}", "x");
    expect(result.value).toBe("Fallback x");
    expect(result.original).toBe("Fallback x");
    // value === original（因为没找到翻译，message === originalMessage）
  });

  it("localize2 返回结构包含 value 和 original 字段", () => {
    const result = nls.localize2("undo", "Undo");
    expect(result).toHaveProperty("value");
    expect(result).toHaveProperty("original");
    expect(typeof result.value).toBe("string");
    expect(typeof result.original).toBe("string");
  });
});

describe("Monaco NLS 适配模块 — 英文模式", () => {
  let nls: typeof import("./nls");

  beforeEach(async () => {
    nls = await importNlsWithLocale("en");
  });

  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it("英文模式下字符串 key 返回原始英文", () => {
    expect(nls.localize("undo", "Undo")).toBe("Undo");
    expect(nls.localize("actions.clipboard.cutLabel", "Cut")).toBe("Cut");
    expect(nls.localize("comment.line", "Toggle Line Comment")).toBe("Toggle Line Comment");
  });

  it("英文模式下 { key, comment } 返回原始英文", () => {
    expect(
      nls.localize({ key: "miUndo", comment: ["&& denotes a mnemonic"] }, "&&Undo")
    ).toBe("&&Undo");
    expect(
      nls.localize({ key: "miFind", comment: ["&& denotes a mnemonic"] }, "&&Find")
    ).toBe("&&Find");
  });

  it("英文模式下参数占位符正确替换", () => {
    expect(nls.localize("label.matchesLocation", "{0} of {1}", 3, 10)).toBe("3 of 10");
    expect(nls.localize("unknown.key", "Value: {0}", "test")).toBe("Value: test");
  });

  it("英文模式下 localize2 value 和 original 均为英文", () => {
    const result = nls.localize2("undo", "Undo");
    expect(result.value).toBe("Undo");
    expect(result.original).toBe("Undo");
  });

  it("英文模式下 getNLSLanguage 返回 en", () => {
    expect(nls.getNLSLanguage()).toBe("en");
  });

  it("英文模式下不返回空字符串", () => {
    expect(nls.localize("undo", "Undo")).not.toBe("");
    expect(nls.localize("unknown", "Fallback")).not.toBe("");
  });
});

describe("Monaco NLS 适配模块 — 无 localStorage 环境（Worker 安全）", () => {
  it("无 localStorage 时不报错，回退默认中文", async () => {
    const nls = await importNlsWithoutLocalStorage();
    expect(nls.getNLSLanguage()).toBe("zh");
    expect(nls.localize("undo", "Undo")).toBe("撤销");
    expect(nls.localize("unknown.key", "Fallback")).toBe("Fallback");
  });

  it("无 localStorage 时 localize2 不报错", async () => {
    const nls = await importNlsWithoutLocalStorage();
    const result = nls.localize2("undo", "Undo");
    expect(result.value).toBe("撤销");
    expect(result.original).toBe("Undo");
  });

  it("无 localStorage 时未知 key 回退英文", async () => {
    const nls = await importNlsWithoutLocalStorage();
    expect(nls.localize("nonexistent", "English Only")).toBe("English Only");
    expect(nls.localize("nonexistent", "English Only")).not.toBe("");
  });
});

describe("Monaco NLS 适配模块 — 默认语言（无 cppteach:locale）", () => {
  it("locale 不存在时默认为中文", async () => {
    const nls = await importNlsWithLocale(null);
    expect(nls.getNLSLanguage()).toBe("zh");
    expect(nls.localize("undo", "Undo")).toBe("撤销");
  });

  it("locale 为无效值时默认为中文", async () => {
    localStorage.setItem(STORAGE_KEY, "fr");
    vi.resetModules();
    const nls = await import("./nls");
    expect(nls.getNLSLanguage()).toBe("zh");
    localStorage.removeItem(STORAGE_KEY);
  });
});

describe("Monaco NLS 适配模块 — 翻译覆盖完整性", () => {
  let nls: typeof import("./nls");

  beforeEach(async () => {
    nls = await importNlsWithLocale("zh");
  });

  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  // 验证任务要求覆盖的最低翻译集合
  it("Undo / Redo / Select All 已翻译", () => {
    expect(nls.localize("undo", "Undo")).toBe("撤销");
    expect(nls.localize("redo", "Redo")).toBe("重做");
    expect(nls.localize("selectAll", "Select All")).toBe("全选");
  });

  it("Cut / Copy / Paste / Copy As 已翻译", () => {
    expect(nls.localize("actions.clipboard.cutLabel", "Cut")).toBe("剪切");
    expect(nls.localize("actions.clipboard.copyLabel", "Copy")).toBe("复制");
    expect(nls.localize("actions.clipboard.pasteLabel", "Paste")).toBe("粘贴");
    expect(nls.localize("copy as", "Copy As")).toBe("复制为");
  });

  it("Find / Replace 及相关已翻译", () => {
    expect(nls.localize("startFindAction", "Find")).toBe("查找");
    expect(nls.localize("startReplace", "Replace")).toBe("替换");
    expect(nls.localize("label.previousMatchButton", "Previous Match")).toBe("上一个匹配项");
    expect(nls.localize("label.nextMatchButton", "Next Match")).toBe("下一个匹配项");
  });

  it("No Results / No Results Found 已翻译", () => {
    expect(nls.localize("label.noResults", "No results")).toBe("无结果");
    expect(
      nls.localize("findMatchAction.noResults", "No matches. Try searching for something else.")
    ).toBe("未找到匹配项。请尝试搜索其他内容。");
  });

  it("Match Case / Match Whole Word / Use Regular Expression 已翻译", () => {
    expect(nls.localize("caseDescription", "Match Case")).toBe("区分大小写");
    expect(nls.localize("wordsDescription", "Match Whole Word")).toBe("全字匹配");
    expect(nls.localize("regexDescription", "Use Regular Expression")).toBe("使用正则表达式");
  });

  it("Preserve Case / Find in Selection 已翻译", () => {
    expect(nls.localize("label.preserveCaseToggle", "Preserve Case")).toBe("保留大小写");
    expect(nls.localize("label.toggleSelectionFind", "Find in Selection")).toBe("在选区中查找");
  });

  it("Change All Occurrences 已翻译", () => {
    expect(nls.localize("changeAll.label", "Change All Occurrences")).toBe("更改所有匹配项");
  });

  it("Add Selection to Next Find Match 已翻译", () => {
    expect(
      nls.localize("addSelectionToNextFindMatch", "Add Selection To Next Find Match")
    ).toBe("添加选区到下一个匹配项");
  });

  it("Toggle Line Comment / Toggle Block Comment 已翻译", () => {
    expect(nls.localize("comment.line", "Toggle Line Comment")).toBe("切换行注释");
    expect(nls.localize("comment.block", "Toggle Block Comment")).toBe("切换块注释");
  });

  it("Fold / Unfold / Fold All / Unfold All 已翻译", () => {
    expect(nls.localize("foldAction.label", "Fold")).toBe("折叠");
    expect(nls.localize("unfoldAction.label", "Unfold")).toBe("展开");
    expect(nls.localize("foldAllAction.label", "Fold All")).toBe("全部折叠");
    expect(nls.localize("unfoldAllAction.label", "Unfold All")).toBe("全部展开");
  });

  it("Indent Line / Outdent Line 已翻译", () => {
    expect(nls.localize("lines.indent", "Indent Line")).toBe("增加缩进");
    expect(nls.localize("lines.outdent", "Outdent Line")).toBe("减少缩进");
  });

  it("Copy Line Up / Copy Line Down 已翻译", () => {
    expect(nls.localize("lines.copyUp", "Copy Line Up")).toBe("向上复制行");
    expect(nls.localize("lines.copyDown", "Copy Line Down")).toBe("向下复制行");
  });

  it("Move Line Up / Move Line Down 已翻译", () => {
    expect(nls.localize("lines.moveUp", "Move Line Up")).toBe("向上移动行");
    expect(nls.localize("lines.moveDown", "Move Line Down")).toBe("向下移动行");
  });

  it("Delete Line 已翻译", () => {
    expect(nls.localize("lines.delete", "Delete Line")).toBe("删除行");
  });

  it("Insert Line Above / Insert Line Below 已翻译", () => {
    expect(nls.localize("lines.insertBefore", "Insert Line Above")).toBe("在上方插入行");
    expect(nls.localize("lines.insertAfter", "Insert Line Below")).toBe("在下方插入行");
  });

  it("Expand Selection / Shrink Selection 已翻译", () => {
    expect(nls.localize("smartSelect.expand", "Expand Selection")).toBe("展开选区");
    expect(nls.localize("smartSelect.shrink", "Shrink Selection")).toBe("收缩选区");
  });

  it("Go to Bracket 已翻译", () => {
    expect(nls.localize("smartSelect.jumpBracket", "Go to Bracket")).toBe("转到括号");
  });
});

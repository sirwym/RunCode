// Monaco ESM NLS 适配模块
//
// 通过 Vite 解析规则将 monaco-editor/esm/vs/nls.js 重定向到本模块，
// 在不切换 AMD loader、不复制 vs 目录、不引入新依赖的前提下实现中文本地化。
//
// 设计要点：
// - localize/localize2 兼容 Monaco ESM 的三种调用形式：
//   1. localize('key', "English", ...args)        — 字符串 key
//   2. localize({ key, comment }, "English", ...args) — 对象 key（菜单助记符）
//   3. localize(number, "English", ...args)        — 构建期数字索引（ESM 不使用，回退英文）
// - 未收录 key 必须回退到调用方提供的英文 fallback，不得返回空串或 key 本身。
// - 模块加载时读取一次 cppteach:locale，不支持热切换（Monaco 文案在注册期固化）。
// - Worker 安全：editor.worker 不导入 nls.js，但防御性判断 localStorage 可用性。

type Locale = "zh" | "en";

const STORAGE_KEY = "cppteach:locale";

// 中文翻译字典：以 Monaco 稳定 key 为索引，不按英文文本全局替换。
// 仅收录当前已启用 contribution 中用户可见的文案。
const ZH_MESSAGES: Record<string, string> = {
  // === editorExtensions.js — Undo / Redo / Select All ===
  undo: "撤销",
  miUndo: "撤销",
  redo: "重做",
  miRedo: "重做",
  selectAll: "全选",
  miSelectAll: "全选",

  // === clipboard.js ===
  miCut: "剪切",
  "actions.clipboard.cutLabel": "剪切",
  miCopy: "复制",
  "actions.clipboard.copyLabel": "复制",
  "copy as": "复制为",
  miPaste: "粘贴",
  "actions.clipboard.pasteLabel": "粘贴",
  "actions.clipboard.copyWithSyntaxHighlightingLabel": "复制并保留语法高亮",

  // === comment.js ===
  "comment.line": "切换行注释",
  miToggleLineComment: "切换行注释",
  "comment.line.add": "添加行注释",
  "comment.line.remove": "移除行注释",
  "comment.block": "切换块注释",
  miToggleBlockComment: "切换块注释",

  // === contextmenu.js ===
  "action.showContextMenu.label": "显示编辑器上下文菜单",

  // === cursorUndo.js ===
  "cursor.undo": "光标撤销",
  "cursor.redo": "光标重做",

  // === findController.js ===
  startFindAction: "查找",
  miFind: "查找",
  startFindWithArgsAction: "查找（带参数）",
  startFindWithSelectionAction: "查找选中内容",
  findNextMatchAction: "查找下一个",
  findPreviousMatchAction: "查找上一个",
  "findMatchAction.goToMatch": "转到匹配项…",
  "findMatchAction.noResults": "未找到匹配项。请尝试搜索其他内容。",
  "findMatchAction.inputPlaceHolder": "输入数字以转到特定匹配项（1 到 {0}）",
  "findMatchAction.inputValidationMessage": "请输入 1 到 {0} 之间的数字",
  nextSelectionMatchFindAction: "查找下一个选中内容",
  previousSelectionMatchFindAction: "查找上一个选中内容",
  startReplace: "替换",
  miReplace: "替换",
  "too.large.for.replaceall": "文件太大，无法执行全部替换操作。",

  // === findWidget.js ===
  "label.findDialog": "查找 / 替换",
  "label.find": "查找",
  "placeholder.find": "查找",
  "label.previousMatchButton": "上一个匹配项",
  "label.nextMatchButton": "下一个匹配项",
  "label.toggleSelectionFind": "在选区中查找",
  "label.closeButton": "关闭",
  "label.replace": "替换",
  "placeholder.replace": "替换",
  "label.replaceButton": "替换",
  "label.replaceAllButton": "全部替换",
  "label.toggleReplaceButton": "切换替换模式",
  "label.matchesLocation": "{0} / {1}",
  "label.noResults": "无结果",
  "title.matchesCountLimit": "仅高亮前 {0} 个结果，但所有查找操作仍作用于全文。",

  // === findInputToggles.js ===
  caseDescription: "区分大小写",
  wordsDescription: "全字匹配",
  regexDescription: "使用正则表达式",

  // === replaceInput.js ===
  "label.preserveCaseToggle": "保留大小写",
  defaultLabel: "输入",

  // === folding.js ===
  "unfoldAction.label": "展开",
  "foldAction.label": "折叠",
  "toggleFoldAction.label": "切换折叠",
  "foldRecursivelyAction.label": "递归折叠",
  "unFoldRecursivelyAction.label": "递归展开",
  "toggleFoldRecursivelyAction.label": "切换递归折叠",
  "foldAllBlockComments.label": "折叠所有块注释",
  "foldAllMarkerRegions.label": "折叠所有区域",
  "unfoldAllMarkerRegions.label": "展开所有区域",
  "foldAllExcept.label": "折叠除选中外的所有区域",
  "unfoldAllExcept.label": "展开除选中外的所有区域",
  "foldAllAction.label": "全部折叠",
  "unfoldAllAction.label": "全部展开",
  "gotoParentFold.label": "转到父折叠",
  "gotoPreviousFold.label": "转到上一个折叠区域",
  "gotoNextFold.label": "转到下一个折叠区域",
  "createManualFoldRange.label": "从选区创建折叠区域",
  "removeManualFoldingRanges.label": "移除手动折叠区域",
  "foldLevelAction.label": "折叠 {0} 级",

  // === indentation.js ===
  indentationToSpaces: "将缩进转换为空格",
  indentationToTabs: "将缩进转换为制表符",
  configuredTabSize: "已配置的制表符宽度",
  defaultTabSize: "默认制表符宽度",
  currentTabSize: "当前制表符宽度",
  selectTabSize: "选择当前文件的制表符宽度",
  indentUsingTabs: "使用制表符缩进",
  indentUsingSpaces: "使用空格缩进",
  changeTabDisplaySize: "更改制表符显示宽度",
  detectIndentation: "从内容检测缩进",
  "editor.reindentlines": "重新缩进行",
  "editor.reindentselectedlines": "重新缩进选中行",

  // === linesOperations.js ===
  "lines.copyUp": "向上复制行",
  miCopyLinesUp: "向上复制行",
  "lines.copyDown": "向下复制行",
  miCopyLinesDown: "向下复制行",
  duplicateSelection: "复制选区",
  miDuplicateSelection: "复制选区",
  "lines.moveUp": "向上移动行",
  miMoveLinesUp: "向上移动行",
  "lines.moveDown": "向下移动行",
  miMoveLinesDown: "向下移动行",
  "lines.sortAscending": "升序排序行",
  "lines.sortDescending": "降序排序行",
  "lines.deleteDuplicates": "删除重复行",
  "lines.trimTrailingWhitespace": "修剪行尾空白",
  "lines.delete": "删除行",
  "lines.indent": "增加缩进",
  "lines.outdent": "减少缩进",
  "lines.insertBefore": "在上方插入行",
  "lines.insertAfter": "在下方插入行",
  "lines.deleteAllLeft": "删除左侧所有内容",
  "lines.deleteAllRight": "删除右侧所有内容",
  "lines.joinLines": "合并行",

  // === links.js ===
  label: "打开链接",
  "invalid.url": "无法打开此链接，因为其格式不正确: {0}",
  "missing.url": "无法打开此链接，因为其目标缺失。",
  "links.navigate.executeCmd": "执行命令",
  "links.navigate.follow": "跟随链接",
  "tooltip.explanation": "执行命令 {0}",

  // === multicursor.js ===
  "mutlicursor.insertAbove": "在上方添加光标",
  miInsertCursorAbove: "在上方添加光标",
  "mutlicursor.insertBelow": "在下方添加光标",
  miInsertCursorBelow: "在下方添加光标",
  "mutlicursor.insertAtEndOfEachLineSelected": "在每行末尾添加光标",
  miInsertCursorAtEndOfEachLineSelected: "在每行末尾添加光标",
  "mutlicursor.addCursorsToBottom": "在底部添加光标",
  "mutlicursor.addCursorsToTop": "在顶部添加光标",
  addSelectionToNextFindMatch: "添加选区到下一个匹配项",
  miAddSelectionToNextFindMatch: "添加下一个匹配项",
  addSelectionToPreviousFindMatch: "添加选区到上一个匹配项",
  miAddSelectionToPreviousFindMatch: "添加上一个匹配项",
  moveSelectionToNextFindMatch: "移动最后选区到下一个匹配项",
  moveSelectionToPreviousFindMatch: "移动最后选区到上一个匹配项",
  selectAllOccurrencesOfFindMatch: "选择所有匹配项",
  miSelectHighlights: "选择所有匹配项",
  "changeAll.label": "更改所有匹配项",
  cursorAdded: "已添加光标: {0}",
  cursorsAdded: "已添加 {0} 个光标",
  "mutlicursor.focusNextCursor": "聚焦下一个光标",
  "mutlicursor.focusPreviousCursor": "聚焦上一个光标",

  // === smartSelect.js / bracketMatching.js ===
  "smartSelect.expand": "展开选区",
  miSmartSelectGrow: "展开选区",
  "smartSelect.shrink": "收缩选区",
  miSmartSelectShrink: "收缩选区",
  "smartSelect.jumpBracket": "转到括号",
  miGoToBracket: "转到括号",
  "smartSelect.selectToBracket": "选择到括号",
  "smartSelect.removeBrackets": "移除括号",

  // === suggestController.js ===
  "suggest.trigger.label": "触发代码建议",
  "accept.insert": "插入",
  "accept.replace": "替换",
  "detail.more": "显示更少",
  "detail.less": "显示更多",
  "suggest.reset.label": "重置建议窗口大小",

  // === wordHighlighter.js ===
  "wordHighlight.next.label": "转到下一个符号高亮",
  "wordHighlight.previous.label": "转到上一个符号高亮",
  "wordHighlight.trigger.label": "触发符号高亮",

  // === hoverActions.js ===
  showOrFocusHover: "显示或聚焦悬停",
  showDefinitionPreviewHover: "显示定义预览悬停",
  scrollUpHover: "向上滚动悬停",
  scrollDownHover: "向下滚动悬停",
  scrollLeftHover: "向左滚动悬停",
  scrollRightHover: "向右滚动悬停",
  pageUpHover: "向上翻页悬停",
  pageDownHover: "向下翻页悬停",
  goToTopHover: "转到悬停顶部",
  goToBottomHover: "转到悬停底部",
};

// 检测当前语言：读取 cppteach:locale，无效则默认中文。
// Worker 安全：localStorage 在 Worker 中不可用，catch 后回退默认值。
function detectLocale(): Locale {
  try {
    const g = globalThis as unknown as {
      localStorage?: Storage;
    };
    if (g && typeof g.localStorage !== "undefined" && g.localStorage) {
      const saved = g.localStorage.getItem(STORAGE_KEY);
      if (saved === "zh" || saved === "en") return saved;
    }
  } catch {
    // localStorage 不可用（Worker / 沙箱），回退默认值
  }
  return "zh";
}

const CURRENT_LOCALE: Locale = detectLocale();

// {0} {1} ... 占位符替换（与 Monaco _format 行为一致）
function format(message: string, args: unknown[]): string {
  if (args.length === 0) return message;
  return message.replace(/\{(\d+)\}/g, (match, indexStr: string) => {
    const index = parseInt(indexStr, 10);
    if (index >= 0 && index < args.length) {
      const arg = args[index];
      if (typeof arg === "string") return arg;
      if (typeof arg === "number" || typeof arg === "boolean") return String(arg);
      if (arg === undefined || arg === null) return String(arg);
    }
    return match;
  });
}

// 从 data 中提取 NLS key：
// - 字符串 → 直接作为 key
// - { key, comment } → 取 key 字段
// - number → 构建期索引（ESM 不使用），返回 null 表示走英文回退
function extractKey(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (data !== null && typeof data === "object" && "key" in data) {
    const k = (data as { key: unknown }).key;
    return typeof k === "string" ? k : null;
  }
  return null;
}

// 查找中文翻译：locale 为 zh 且 key 在字典中时返回中文，否则返回 null
function lookupZh(key: string | null): string | null {
  if (CURRENT_LOCALE !== "zh" || !key) return null;
  return ZH_MESSAGES[key] ?? null;
}

export function localize(
  data: string | number | { key: string; comment: string[] },
  message: string,
  ...args: unknown[]
): string {
  const key = typeof data === "number" ? null : extractKey(data);
  const zh = lookupZh(key);
  // 未收录 key 或英文模式：回退到调用方提供的英文 message
  const finalMessage = zh ?? message;
  return format(finalMessage, args);
}

export function localize2(
  data: string | number | { key: string; comment: string[] },
  originalMessage: string,
  ...args: unknown[]
): { value: string; original: string } {
  const key = typeof data === "number" ? null : extractKey(data);
  const zh = lookupZh(key);
  const message = zh ?? originalMessage;
  const value = format(message, args);
  // original 始终基于英文原文（供 a11y / 辅助技术使用）
  const original =
    originalMessage === message ? value : format(originalMessage, args);
  return { value, original };
}

export function getNLSLanguage(): string | undefined {
  return CURRENT_LOCALE;
}

export function getNLSMessages(): string[] | undefined {
  // ESM 模式下不使用构建期 NLS 表；保留 globalThis 兼容性
  return (globalThis as unknown as { _VSCODE_NLS_MESSAGES?: string[] })
    ._VSCODE_NLS_MESSAGES;
}

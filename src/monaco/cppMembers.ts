// C++ 成员方法补全数据源 + 类型推断
// 当用户输入 `变量.` 时，前端基于变量声明推断类型，从本表取出成员并以 snippet 模板弹出
// kind 由调用方（Editor.tsx）映射为 monaco.languages.CompletionItemKind

export interface MemberDef {
  label: string; // 补全项显示名，如 "substr"
  detail: string; // 归属类型，如 "string"
  insertText: string; // snippet 语法，如 "substr(${1:pos}, ${2:len})"；字段（pair.first）写纯标识符
  documentation?: string; // 简短中文说明
}

// ============== string ==============
const STRING_MEMBERS: MemberDef[] = [
  { label: "size", detail: "string", insertText: "size()", documentation: "返回字符数" },
  { label: "length", detail: "string", insertText: "length()", documentation: "返回字符数（同 size）" },
  { label: "empty", detail: "string", insertText: "empty()", documentation: "是否为空" },
  { label: "clear", detail: "string", insertText: "clear()", documentation: "清空" },
  { label: "append", detail: "string", insertText: "append(${1:str})", documentation: "末尾追加字符串" },
  { label: "push_back", detail: "string", insertText: "push_back(${1:ch})", documentation: "末尾追加字符" },
  { label: "pop_back", detail: "string", insertText: "pop_back()", documentation: "删除末尾字符" },
  { label: "substr", detail: "string", insertText: "substr(${1:pos}, ${2:len})", documentation: "返回从 pos 开始长度为 len 的子串" },
  { label: "find", detail: "string", insertText: "find(${1:str}, ${2:pos})", documentation: "从前向后查找，返回下标，未找到返回 npos" },
  { label: "rfind", detail: "string", insertText: "rfind(${1:str}, ${2:pos})", documentation: "从后向前查找" },
  { label: "find_first_of", detail: "string", insertText: "find_first_of(${1:str}, ${2:pos})", documentation: "查找第一个出现在 str 中的字符" },
  { label: "find_first_not_of", detail: "string", insertText: "find_first_not_of(${1:str}, ${2:pos})", documentation: "查找第一个不在 str 中的字符" },
  { label: "find_last_of", detail: "string", insertText: "find_last_of(${1:str}, ${2:pos})", documentation: "查找最后一个出现在 str 中的字符" },
  { label: "find_last_not_of", detail: "string", insertText: "find_last_not_of(${1:str}, ${2:pos})", documentation: "查找最后一个不在 str 中的字符" },
  { label: "insert", detail: "string", insertText: "insert(${1:pos}, ${2:str})", documentation: "在 pos 处插入字符串" },
  { label: "erase", detail: "string", insertText: "erase(${1:pos}, ${2:len})", documentation: "删除从 pos 开始长度为 len 的子串" },
  { label: "replace", detail: "string", insertText: "replace(${1:pos}, ${2:len}, ${3:str})", documentation: "替换从 pos 开始长度为 len 的子串为 str" },
  { label: "c_str", detail: "string", insertText: "c_str()", documentation: "返回 C 风格字符串（以 '\\0' 结尾）" },
  { label: "data", detail: "string", insertText: "data()", documentation: "返回字符数组指针" },
  { label: "compare", detail: "string", insertText: "compare(${1:str})", documentation: "按字典序比较" },
  { label: "resize", detail: "string", insertText: "resize(${1:n}, ${2:ch})", documentation: "调整长度，多出的用 ch 填充" },
  { label: "reserve", detail: "string", insertText: "reserve(${1:n})", documentation: "预分配至少 n 字符容量" },
  { label: "capacity", detail: "string", insertText: "capacity()", documentation: "返回当前容量" },
  { label: "at", detail: "string", insertText: "at(${1:pos})", documentation: "返回 pos 处字符（带边界检查）" },
  { label: "back", detail: "string", insertText: "back()", documentation: "返回末尾字符" },
  { label: "front", detail: "string", insertText: "front()", documentation: "返回首字符" },
  { label: "begin", detail: "string", insertText: "begin()", documentation: "返回首迭代器" },
  { label: "end", detail: "string", insertText: "end()", documentation: "返回尾迭代器" },
  { label: "rbegin", detail: "string", insertText: "rbegin()", documentation: "返回反向首迭代器" },
  { label: "rend", detail: "string", insertText: "rend()", documentation: "返回反向尾迭代器" },
];

// ============== vector ==============
const VECTOR_MEMBERS: MemberDef[] = [
  { label: "push_back", detail: "vector", insertText: "push_back(${1:val})", documentation: "末尾追加元素" },
  { label: "emplace_back", detail: "vector", insertText: "emplace_back(${1:args})", documentation: "末尾原位构造元素" },
  { label: "pop_back", detail: "vector", insertText: "pop_back()", documentation: "删除末尾元素" },
  { label: "size", detail: "vector", insertText: "size()", documentation: "返回元素数" },
  { label: "empty", detail: "vector", insertText: "empty()", documentation: "是否为空" },
  { label: "clear", detail: "vector", insertText: "clear()", documentation: "清空" },
  { label: "insert", detail: "vector", insertText: "insert(${1:pos}, ${2:val})", documentation: "在 pos 处插入元素" },
  { label: "erase", detail: "vector", insertText: "erase(${1:pos})", documentation: "删除 pos 处元素" },
  { label: "resize", detail: "vector", insertText: "resize(${1:n})", documentation: "调整元素数" },
  { label: "reserve", detail: "vector", insertText: "reserve(${1:n})", documentation: "预分配容量" },
  { label: "capacity", detail: "vector", insertText: "capacity()", documentation: "返回当前容量" },
  { label: "begin", detail: "vector", insertText: "begin()", documentation: "返回首迭代器" },
  { label: "end", detail: "vector", insertText: "end()", documentation: "返回尾迭代器" },
  { label: "at", detail: "vector", insertText: "at(${1:pos})", documentation: "返回 pos 处元素（带边界检查）" },
  { label: "front", detail: "vector", insertText: "front()", documentation: "返回首元素" },
  { label: "back", detail: "vector", insertText: "back()", documentation: "返回末元素" },
];

// ============== deque（vector 全部 + push_front/pop_front） ==============
const DEQUE_MEMBERS: MemberDef[] = [
  ...VECTOR_MEMBERS.map((m) => ({ ...m, detail: "deque" })),
  { label: "push_front", detail: "deque", insertText: "push_front(${1:val})", documentation: "头部插入元素" },
  { label: "pop_front", detail: "deque", insertText: "pop_front()", documentation: "删除头部元素" },
];

// ============== list（deque 全部 + 链表特有方法） ==============
const LIST_MEMBERS: MemberDef[] = [
  ...DEQUE_MEMBERS.map((m) => ({ ...m, detail: "list" })),
  { label: "splice", detail: "list", insertText: "splice(${1:pos}, ${2:other})", documentation: "将 other 接合到 pos 处" },
  { label: "unique", detail: "list", insertText: "unique()", documentation: "删除连续重复元素" },
  { label: "remove", detail: "list", insertText: "remove(${1:val})", documentation: "删除所有等于 val 的元素" },
  { label: "remove_if", detail: "list", insertText: "remove_if(${1:pred})", documentation: "删除满足谓词的元素" },
  { label: "sort", detail: "list", insertText: "sort()", documentation: "链表排序" },
  { label: "reverse", detail: "list", insertText: "reverse()", documentation: "反转链表" },
  { label: "merge", detail: "list", insertText: "merge(${1:other})", documentation: "归并另一个有序链表" },
];

// ============== array ==============
const ARRAY_MEMBERS: MemberDef[] = [
  { label: "size", detail: "array", insertText: "size()", documentation: "返回元素数" },
  { label: "empty", detail: "array", insertText: "empty()", documentation: "是否为空" },
  { label: "at", detail: "array", insertText: "at(${1:pos})", documentation: "返回 pos 处元素（带边界检查）" },
  { label: "front", detail: "array", insertText: "front()", documentation: "返回首元素" },
  { label: "back", detail: "array", insertText: "back()", documentation: "返回末元素" },
  { label: "begin", detail: "array", insertText: "begin()", documentation: "返回首迭代器" },
  { label: "end", detail: "array", insertText: "end()", documentation: "返回尾迭代器" },
  { label: "fill", detail: "array", insertText: "fill(${1:val})", documentation: "填充所有元素为 val" },
  { label: "swap", detail: "array", insertText: "swap(${1:other})", documentation: "交换内容" },
];

// ============== map / unordered_map / multimap / unordered_multimap ==============
const MAP_MEMBERS: MemberDef[] = [
  { label: "insert", detail: "map", insertText: "insert({${1:key}, ${2:val}})", documentation: "插入键值对" },
  { label: "erase", detail: "map", insertText: "erase(${1:key})", documentation: "按键删除" },
  { label: "find", detail: "map", insertText: "find(${1:key})", documentation: "按键查找，未找到返回 end()" },
  { label: "count", detail: "map", insertText: "count(${1:key})", documentation: "返回键的数量" },
  { label: "size", detail: "map", insertText: "size()", documentation: "返回元素数" },
  { label: "empty", detail: "map", insertText: "empty()", documentation: "是否为空" },
  { label: "clear", detail: "map", insertText: "clear()", documentation: "清空" },
  { label: "begin", detail: "map", insertText: "begin()", documentation: "返回首迭代器" },
  { label: "end", detail: "map", insertText: "end()", documentation: "返回尾迭代器" },
  { label: "at", detail: "map", insertText: "at(${1:key})", documentation: "按键访问（带边界检查）" },
  { label: "lower_bound", detail: "map", insertText: "lower_bound(${1:key})", documentation: "返回不小于 key 的首迭代器（仅有序 map）" },
  { label: "upper_bound", detail: "map", insertText: "upper_bound(${1:key})", documentation: "返回大于 key 的首迭代器（仅有序 map）" },
];

// ============== set / multiset ==============
const SET_MEMBERS: MemberDef[] = [
  { label: "insert", detail: "set", insertText: "insert(${1:val})", documentation: "插入元素" },
  { label: "erase", detail: "set", insertText: "erase(${1:val})", documentation: "删除元素" },
  { label: "find", detail: "set", insertText: "find(${1:val})", documentation: "查找元素，未找到返回 end()" },
  { label: "count", detail: "set", insertText: "count(${1:val})", documentation: "返回元素数量" },
  { label: "size", detail: "set", insertText: "size()", documentation: "返回元素数" },
  { label: "empty", detail: "set", insertText: "empty()", documentation: "是否为空" },
  { label: "clear", detail: "set", insertText: "clear()", documentation: "清空" },
  { label: "begin", detail: "set", insertText: "begin()", documentation: "返回首迭代器" },
  { label: "end", detail: "set", insertText: "end()", documentation: "返回尾迭代器" },
  { label: "lower_bound", detail: "set", insertText: "lower_bound(${1:val})", documentation: "返回不小于 val 的首迭代器" },
  { label: "upper_bound", detail: "set", insertText: "upper_bound(${1:val})", documentation: "返回大于 val 的首迭代器" },
];

// ============== unordered_set / unordered_multiset（set minus lower/upper_bound） ==============
const UNORDERED_SET_MEMBERS: MemberDef[] = SET_MEMBERS.filter(
  (m) => m.label !== "lower_bound" && m.label !== "upper_bound"
).map((m) => ({ ...m, detail: "unordered_set" }));

// ============== stack ==============
const STACK_MEMBERS: MemberDef[] = [
  { label: "push", detail: "stack", insertText: "push(${1:val})", documentation: "入栈" },
  { label: "pop", detail: "stack", insertText: "pop()", documentation: "出栈" },
  { label: "top", detail: "stack", insertText: "top()", documentation: "访问栈顶元素" },
  { label: "size", detail: "stack", insertText: "size()", documentation: "返回元素数" },
  { label: "empty", detail: "stack", insertText: "empty()", documentation: "是否为空" },
];

// ============== queue ==============
const QUEUE_MEMBERS: MemberDef[] = [
  { label: "push", detail: "queue", insertText: "push(${1:val})", documentation: "入队" },
  { label: "pop", detail: "queue", insertText: "pop()", documentation: "出队" },
  { label: "front", detail: "queue", insertText: "front()", documentation: "访问队首" },
  { label: "back", detail: "queue", insertText: "back()", documentation: "访问队尾" },
  { label: "size", detail: "queue", insertText: "size()", documentation: "返回元素数" },
  { label: "empty", detail: "queue", insertText: "empty()", documentation: "是否为空" },
];

// ============== priority_queue ==============
const PRIORITY_QUEUE_MEMBERS: MemberDef[] = [
  { label: "push", detail: "priority_queue", insertText: "push(${1:val})", documentation: "入队" },
  { label: "pop", detail: "priority_queue", insertText: "pop()", documentation: "出队（堆顶）" },
  { label: "top", detail: "priority_queue", insertText: "top()", documentation: "访问堆顶" },
  { label: "size", detail: "priority_queue", insertText: "size()", documentation: "返回元素数" },
  { label: "empty", detail: "priority_queue", insertText: "empty()", documentation: "是否为空" },
];

// ============== pair（first/second 是字段，不是方法） ==============
const PAIR_MEMBERS: MemberDef[] = [
  { label: "first", detail: "pair", insertText: "first", documentation: "第一个元素" },
  { label: "second", detail: "pair", insertText: "second", documentation: "第二个元素" },
];

// 类型别名 → 成员方法列表
export const CPP_MEMBERS: Record<string, MemberDef[]> = {
  string: STRING_MEMBERS,
  vector: VECTOR_MEMBERS,
  deque: DEQUE_MEMBERS,
  list: LIST_MEMBERS,
  array: ARRAY_MEMBERS,
  map: MAP_MEMBERS,
  multimap: MAP_MEMBERS.map((m) => ({ ...m, detail: "multimap" })),
  unordered_map: MAP_MEMBERS.filter(
    (m) => m.label !== "lower_bound" && m.label !== "upper_bound"
  ).map((m) => ({ ...m, detail: "unordered_map" })),
  unordered_multimap: MAP_MEMBERS.filter(
    (m) => m.label !== "lower_bound" && m.label !== "upper_bound"
  ).map((m) => ({ ...m, detail: "unordered_multimap" })),
  set: SET_MEMBERS,
  multiset: SET_MEMBERS.map((m) => ({ ...m, detail: "multiset" })),
  unordered_set: UNORDERED_SET_MEMBERS,
  unordered_multiset: UNORDERED_SET_MEMBERS.map((m) => ({ ...m, detail: "unordered_multiset" })),
  stack: STACK_MEMBERS,
  queue: QUEUE_MEMBERS,
  priority_queue: PRIORITY_QUEUE_MEMBERS,
  pair: PAIR_MEMBERS,
};

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 语句/声明关键字黑名单：这些不会作为变量类型出现，需从 declRegex 中排除
// 避免把 `return x` `if (x)` `auto a` 等误判为变量声明
const STMT_KEYWORDS_EXCLUDE = [
  "auto", "return", "if", "else", "for", "while", "do", "switch", "case",
  "break", "continue", "goto", "throw", "try", "catch", "sizeof", "new",
  "delete", "operator", "typedef", "using", "namespace", "template",
  "typename", "virtual", "explicit", "friend", "mutable", "volatile",
  "register", "extern", "inline", "constexpr", "override", "final",
  "noexcept", "static", "public", "protected", "private", "class",
  "struct", "enum", "union", "this", "true", "false", "nullptr",
];
const EXCLUDE_PATTERN = STMT_KEYWORDS_EXCLUDE.map((k) => `${k}\\b`).join("|");

// 在光标处 `.` 左侧提取变量名并回溯搜索其声明类型
// 命中已知类型返回别名，否则返回 null（调用方 fallback 到 L2 文件级符号）
export function inferTypeAtDot(
  code: string,
  lineNumber: number, // 1-based
  column: number // 1-based
): string | null {
  const lines = code.split("\n");
  if (lineNumber < 1 || lineNumber > lines.length) return null;
  const line = lines[lineNumber - 1];
  // 取光标前的文本
  const before = line.slice(0, Math.max(0, column - 1));

  // 匹配 `name.` 或 `name .`，禁止匹配链式 `obj.method.`（前面还有标识符+点）
  const m = before.match(/([A-Za-z_]\w*)\s*\.\s*$/);
  if (!m) return null;
  const varName = m[1];

  // 检查是否链式：identifier 前是否还有 `.` 或 `]`/`)` 紧邻（如 `obj.x.` `arr[0].` `foo().`）
  const beforeVar = before.slice(0, before.length - m[0].length).replace(/\s+$/, "");
  if (beforeVar.length > 0) {
    const lastChar = beforeVar[beforeVar.length - 1];
    if (lastChar === "." || lastChar === "]" || lastChar === ")") {
      return null; // 链式调用，fallback
    }
  }

  // 从当前行向上搜索变量声明，取最近一次匹配
  // 用 (?!EXCLUDE)(\w+) 捕获任意类型名（排除语句关键字），然后判断是否在 CPP_MEMBERS 中
  // 这样可正确处理变量遮蔽：最近声明的类型不在表中时返回 null
  // 模板参数支持一层嵌套（vector<vector<int>>）
  // 排除 auto 是为了让 auto 字面量特判能走到
  const varPattern = escapeRegex(varName);
  const declRegex = new RegExp(
    `\\b(?:std::)?(?:const\\s+)?(?!(?:${EXCLUDE_PATTERN}))(\\w+)(?:\\s*<(?:[^<>]|<[^<>]*>)*>)?(?:\\s*const)?(?:\\s*[&*]{1,2})?\\s+(?:\\w+\\s*,\\s*)*${varPattern}\\b`
  );

  for (let i = lineNumber - 1; i >= 0; i--) {
    const lineText = lines[i];
    const matched = lineText.match(declRegex);
    if (matched) {
      const type = matched[1];
      if (type in CPP_MEMBERS) {
        return type;
      }
      return null; // 最近声明类型不在表中，fallback
    }
  }

  // auto 字面量特判：`auto a = "x";` → string
  // 仅处理字符串字面量，其他 auto 不展开
  const autoRegex = new RegExp(`\\bauto\\s+${varPattern}\\s*=\\s*("[^"]*"|'[^']*')`);
  for (let i = lineNumber - 1; i >= 0; i--) {
    const lineText = lines[i];
    const am = lineText.match(autoRegex);
    if (am) {
      const lit = am[1];
      if (lit.startsWith('"')) return "string";
      return null; // char 字面量暂不映射
    }
  }

  return null;
}

// 把 MemberDef[] 转为 Monaco suggestions 的辅助函数
// kindMethod/kindField 由调用方传入映射后的数值（monaco.languages.CompletionItemKind.*）
// isFieldFn 用于区分字段（pair.first/second）与方法：insertText 不含 "(" 视为字段
export interface MemberSuggestion {
  label: string;
  kind: number;
  detail: string;
  insertText: string;
  insertTextRules: number;
  documentation?: string;
  sortText: string;
  range: { startLineNumber: number; endLineNumber: number; startColumn: number; endColumn: number };
}

export function buildMemberSuggestions(
  members: MemberDef[],
  range: { startLineNumber: number; endLineNumber: number; startColumn: number; endColumn: number },
  monacoKindMethod: number,
  monacoKindField: number,
  insertAsSnippetRule: number
): MemberSuggestion[] {
  return members.map((m) => {
    const isField = !m.insertText.includes("(");
    return {
      label: m.label,
      kind: isField ? monacoKindField : monacoKindMethod,
      detail: m.detail,
      insertText: m.insertText,
      insertTextRules: isField ? 0 : insertAsSnippetRule,
      documentation: m.documentation,
      sortText: "0_" + m.label,
      range,
    };
  });
}

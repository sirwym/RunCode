import { describe, it, expect } from "vitest";
import {
  CPP_MEMBERS,
  inferTypeAtDot,
  buildMemberSuggestions,
  type MemberDef,
} from "./cppMembers";

// ============== 数据完整性测试 ==============

describe("CPP_MEMBERS 数据完整性", () => {
  it("覆盖所有声明的类型", () => {
    const requiredTypes = [
      "string",
      "vector",
      "deque",
      "list",
      "array",
      "map",
      "multimap",
      "unordered_map",
      "unordered_multimap",
      "set",
      "multiset",
      "unordered_set",
      "unordered_multiset",
      "stack",
      "queue",
      "priority_queue",
      "pair",
    ];
    for (const t of requiredTypes) {
      expect(CPP_MEMBERS[t]).toBeDefined();
      expect(CPP_MEMBERS[t].length).toBeGreaterThan(0);
    }
  });

  it("每项都有 label/detail/insertText", () => {
    for (const type of Object.keys(CPP_MEMBERS)) {
      for (const m of CPP_MEMBERS[type]) {
        expect(m.label).toBeTruthy();
        expect(m.detail).toBeTruthy();
        expect(m.insertText).toBeTruthy();
      }
    }
  });

  it("同一类型内 label 不重复", () => {
    for (const type of Object.keys(CPP_MEMBERS)) {
      const labels = CPP_MEMBERS[type].map((m) => m.label);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });

  it("label 不含空格", () => {
    for (const type of Object.keys(CPP_MEMBERS)) {
      for (const m of CPP_MEMBERS[type]) {
        expect(m.label).not.toMatch(/\s/);
      }
    }
  });

  it("snippet 占位符语法正确（序号从 1 开始且连续）", () => {
    const placeholderRe = /\$(\d+)(?::[^}]+)?/g;
    for (const type of Object.keys(CPP_MEMBERS)) {
      for (const m of CPP_MEMBERS[type]) {
        const matches = [...m.insertText.matchAll(placeholderRe)];
        if (matches.length === 0) continue;
        const nums = matches.map((x) => parseInt(x[1], 10));
        // 序号从 1 开始
        expect(nums[0]).toBe(1);
        // 序号连续递增
        for (let i = 1; i < nums.length; i++) {
          expect(nums[i]).toBe(nums[i - 1] + 1);
        }
      }
    }
  });

  it("string 至少包含核心方法", () => {
    const labels = CPP_MEMBERS.string.map((m) => m.label);
    const required = [
      "size",
      "length",
      "empty",
      "substr",
      "find",
      "c_str",
      "append",
      "erase",
      "insert",
      "replace",
    ];
    for (const r of required) {
      expect(labels).toContain(r);
    }
  });

  it("vector 至少包含核心方法", () => {
    const labels = CPP_MEMBERS.vector.map((m) => m.label);
    const required = [
      "push_back",
      "pop_back",
      "size",
      "empty",
      "insert",
      "erase",
      "begin",
      "end",
    ];
    for (const r of required) {
      expect(labels).toContain(r);
    }
  });

  it("map 至少包含核心方法", () => {
    const labels = CPP_MEMBERS.map.map((m) => m.label);
    const required = ["insert", "erase", "find", "count", "size", "empty", "begin", "end"];
    for (const r of required) {
      expect(labels).toContain(r);
    }
  });

  it("set 至少包含核心方法", () => {
    const labels = CPP_MEMBERS.set.map((m) => m.label);
    const required = ["insert", "erase", "find", "count", "size", "empty", "begin", "end"];
    for (const r of required) {
      expect(labels).toContain(r);
    }
  });

  it("stack 只包含 push/pop/top/size/empty", () => {
    const labels = CPP_MEMBERS.stack.map((m) => m.label).sort();
    expect(labels).toEqual(["empty", "pop", "push", "size", "top"]);
  });

  it("priority_queue 只包含 push/pop/top/size/empty", () => {
    const labels = CPP_MEMBERS.priority_queue.map((m) => m.label).sort();
    expect(labels).toEqual(["empty", "pop", "push", "size", "top"]);
  });

  it("pair 只包含 first/second（字段）", () => {
    const labels = CPP_MEMBERS.pair.map((m) => m.label).sort();
    expect(labels).toEqual(["first", "second"]);
    // 字段不应有括号
    for (const m of CPP_MEMBERS.pair) {
      expect(m.insertText).not.toContain("(");
    }
  });

  it("unordered_set 不含 lower_bound/upper_bound", () => {
    const labels = CPP_MEMBERS.unordered_set.map((m) => m.label);
    expect(labels).not.toContain("lower_bound");
    expect(labels).not.toContain("upper_bound");
  });

  it("unordered_map 不含 lower_bound/upper_bound", () => {
    const labels = CPP_MEMBERS.unordered_map.map((m) => m.label);
    expect(labels).not.toContain("lower_bound");
    expect(labels).not.toContain("upper_bound");
  });

  it("deque 比 vector 多 push_front/pop_front", () => {
    const labels = CPP_MEMBERS.deque.map((m) => m.label);
    expect(labels).toContain("push_front");
    expect(labels).toContain("pop_front");
  });

  it("deque 不含 reserve/capacity（std::deque 无此方法）", () => {
    const labels = CPP_MEMBERS.deque.map((m) => m.label);
    expect(labels).not.toContain("reserve");
    expect(labels).not.toContain("capacity");
  });

  it("list 比 deque 多链表特有方法", () => {
    const labels = CPP_MEMBERS.list.map((m) => m.label);
    const listOnly = ["splice", "unique", "remove", "remove_if", "sort", "reverse", "merge"];
    for (const m of listOnly) {
      expect(labels).toContain(m);
    }
  });

  it("array 不含 push_back/pop_back/insert/erase", () => {
    const labels = CPP_MEMBERS.array.map((m) => m.label);
    expect(labels).not.toContain("push_back");
    expect(labels).not.toContain("pop_back");
    expect(labels).not.toContain("insert");
    expect(labels).not.toContain("erase");
  });

  it("所有方法 insertText 以括号结尾或为字段（pair）", () => {
    for (const type of Object.keys(CPP_MEMBERS)) {
      for (const m of CPP_MEMBERS[type]) {
        if (type === "pair") {
          expect(m.insertText).not.toContain("(");
        } else {
          expect(m.insertText).toMatch(/\)$/);
        }
      }
    }
  });
});

// ============== 类型推断测试 ==============

describe("inferTypeAtDot", () => {
  // 辅助：构造单行代码并推断
  // 多行代码用 \n 分隔，lineNumber/column 1-based
  function infer(code: string, lineNumber: number, column: number): string | null {
    return inferTypeAtDot(code, lineNumber, column);
  }

  it("string 直接声明", () => {
    const code = "string s;\ns.";
    expect(infer(code, 2, 3)).toBe("string");
  });

  it("std::string 前缀剥离", () => {
    const code = "std::string s;\ns.";
    expect(infer(code, 2, 3)).toBe("string");
  });

  it("string 带初始化", () => {
    const code = 'string s = "x";\ns.';
    expect(infer(code, 2, 3)).toBe("string");
  });

  it("vector 模板声明", () => {
    const code = "vector<int> v;\nv.";
    expect(infer(code, 2, 3)).toBe("vector");
  });

  it("vector 嵌套模板（取外层）", () => {
    const code = "vector<vector<int>> v;\nv.";
    expect(infer(code, 2, 3)).toBe("vector");
  });

  it("vector 多声明匹配后者", () => {
    const code = "vector<int> v, w;\nw.";
    expect(infer(code, 2, 3)).toBe("vector");
  });

  it("const 引用剥离", () => {
    const code = "const string& s = f();\ns.";
    expect(infer(code, 2, 3)).toBe("string");
  });

  it("函数体内局部变量", () => {
    const code = "int main() {\n  string s;\n  s.\n}";
    // line 3 "  s." 长度 4，光标在 `.` 后 column = 5
    expect(infer(code, 3, 5)).toBe("string");
  });

  it("int 不在类型表返回 null", () => {
    const code = "int x;\nx.";
    expect(infer(code, 2, 3)).toBeNull();
  });

  it("未声明的变量返回 null", () => {
    const code = "int main() {}\nxyz.";
    // line 2 "xyz." 长度 4，光标在 `.` 后 column = 5
    expect(infer(code, 2, 5)).toBeNull();
  });

  it("链式调用返回 null", () => {
    const code = 'string s;\ns.substr(0,3).';
    // 末尾 `.` 前是 `)`，不匹配 identifier. 模式
    expect(infer(code, 2, 15)).toBeNull();
  });

  it("arr[i]. 链式返回 null", () => {
    const code = "vector<string> arr;\narr[0].";
    // 末尾 `.` 前是 `]`
    expect(infer(code, 2, 8)).toBeNull();
  });

  it("变量遮蔽：最近的 int 遮蔽 string 返回 null", () => {
    const code = "string s;\n{\n  int s;\n  s.\n}";
    // line 4 "  s." 长度 4，光标在 `.` 后 column = 5
    expect(infer(code, 4, 5)).toBeNull();
  });

  it("变量遮蔽：最近的 string 遮蔽 int 返回 string", () => {
    const code = "int s;\n{\n  string s;\n  s.\n}";
    // line 4 "  s." 长度 4，光标在 `.` 后 column = 5
    expect(infer(code, 4, 5)).toBe("string");
  });

  it("auto 字符串字面量推断为 string", () => {
    const code = 'auto a = "x";\na.';
    expect(infer(code, 2, 3)).toBe("string");
  });

  it("auto char 字面量返回 null", () => {
    const code = "auto a = 'x';\na.";
    expect(infer(code, 2, 3)).toBeNull();
  });

  it("using namespace std 后的 vector", () => {
    const code = "using namespace std;\nvector<int> v;\nv.";
    expect(infer(code, 3, 3)).toBe("vector");
  });

  it("map 声明", () => {
    const code = "map<int,int> m;\nm.";
    expect(infer(code, 2, 3)).toBe("map");
  });

  it("stack 声明", () => {
    const code = "stack<int> st;\nst.";
    expect(infer(code, 2, 4)).toBe("stack");
  });

  it("priority_queue 声明", () => {
    const code = "priority_queue<int> pq;\npq.";
    expect(infer(code, 2, 4)).toBe("priority_queue");
  });

  it("pair 声明", () => {
    const code = "pair<int,int> p;\np.";
    expect(infer(code, 2, 3)).toBe("pair");
  });

  it("跨多行向上搜索声明", () => {
    const code = "vector<int> v;\nint main() {\n  // some code\n  v.\n}";
    // line 4 "  v." 长度 4，光标在 `.` 后 column = 5
    expect(infer(code, 4, 5)).toBe("vector");
  });

  it("光标前无 `.` 返回 null", () => {
    const code = "string s;\ns";
    expect(infer(code, 2, 2)).toBeNull();
  });

  it("行号越界返回 null", () => {
    expect(infer("string s;\ns.", 0, 3)).toBeNull();
    expect(infer("string s;\ns.", 5, 3)).toBeNull();
  });
});

// ============== buildMemberSuggestions 测试 ==============

describe("buildMemberSuggestions", () => {
  const range = { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 5 };
  const KIND_METHOD = 2; // 任意数值
  const KIND_FIELD = 3;
  const SNIPPET_RULE = 4;

  it("返回所有成员", () => {
    const members: MemberDef[] = [
      { label: "size", detail: "string", insertText: "size()" },
      { label: "first", detail: "pair", insertText: "first" },
    ];
    const result = buildMemberSuggestions(members, range, KIND_METHOD, KIND_FIELD, SNIPPET_RULE);
    expect(result.length).toBe(2);
  });

  it("方法用 Method kind + InsertAsSnippet 规则", () => {
    const members: MemberDef[] = [
      { label: "size", detail: "string", insertText: "size()" },
    ];
    const result = buildMemberSuggestions(members, range, KIND_METHOD, KIND_FIELD, SNIPPET_RULE);
    expect(result[0].kind).toBe(KIND_METHOD);
    expect(result[0].insertTextRules).toBe(SNIPPET_RULE);
  });

  it("字段（无括号）用 Field kind + 0 规则", () => {
    const members: MemberDef[] = [
      { label: "first", detail: "pair", insertText: "first" },
    ];
    const result = buildMemberSuggestions(members, range, KIND_METHOD, KIND_FIELD, SNIPPET_RULE);
    expect(result[0].kind).toBe(KIND_FIELD);
    expect(result[0].insertTextRules).toBe(0);
  });

  it("sortText 以 0_ 前缀确保优先", () => {
    const members: MemberDef[] = [
      { label: "size", detail: "string", insertText: "size()" },
    ];
    const result = buildMemberSuggestions(members, range, KIND_METHOD, KIND_FIELD, SNIPPET_RULE);
    expect(result[0].sortText).toBe("0_size");
  });

  it("documentation 透传", () => {
    const members: MemberDef[] = [
      { label: "size", detail: "string", insertText: "size()", documentation: "返回字符数" },
    ];
    const result = buildMemberSuggestions(members, range, KIND_METHOD, KIND_FIELD, SNIPPET_RULE);
    expect(result[0].documentation).toBe("返回字符数");
  });

  it("range 透传", () => {
    const members: MemberDef[] = [
      { label: "size", detail: "string", insertText: "size()" },
    ];
    const result = buildMemberSuggestions(members, range, KIND_METHOD, KIND_FIELD, SNIPPET_RULE);
    expect(result[0].range).toBe(range);
  });

  it("完整 string 成员生成建议", () => {
    const result = buildMemberSuggestions(
      CPP_MEMBERS.string,
      range,
      KIND_METHOD,
      KIND_FIELD,
      SNIPPET_RULE
    );
    expect(result.length).toBe(CPP_MEMBERS.string.length);
    // 所有 string 方法都有括号，应该都是 Method kind
    for (const r of result) {
      expect(r.kind).toBe(KIND_METHOD);
      expect(r.insertTextRules).toBe(SNIPPET_RULE);
    }
  });

  it("pair 成员生成字段建议", () => {
    const result = buildMemberSuggestions(
      CPP_MEMBERS.pair,
      range,
      KIND_METHOD,
      KIND_FIELD,
      SNIPPET_RULE
    );
    for (const r of result) {
      expect(r.kind).toBe(KIND_FIELD);
      expect(r.insertTextRules).toBe(0);
    }
  });
});

// OI 竞赛常用代码片段（Monaco CompletionItemProvider 使用）
// 每项支持 ${n:placeholder} 占位符语法

export interface SnippetDef {
  label: string;
  insertText: string;
  detail: string;
}

export const CPP_SNIPPETS: SnippetDef[] = [
  {
    label: "main",
    insertText: "int main() {\n\t${1}\n\treturn 0;\n}",
    detail: "main 函数模板",
  },
  {
    label: "for",
    insertText: "for (int ${1:i} = ${2:0}; ${1:i} < ${3:n}; ${1:i}++) {\n\t${4}\n}",
    detail: "for 循环",
  },
  {
    label: "while",
    insertText: "while (${1:condition}) {\n\t${2}\n}",
    detail: "while 循环",
  },
  {
    label: "if",
    insertText: "if (${1:condition}) {\n\t${2}\n}",
    detail: "if 语句",
  },
  {
    label: "vector",
    insertText: "vector<${1:int}> ${2:v}(${3:n});",
    detail: "vector 声明",
  },
  {
    label: "map",
    insertText: "map<${1:int}, ${2:int}> ${3:m};",
    detail: "map 声明",
  },
  {
    label: "sort",
    insertText: "sort(${1:v}.begin(), ${1:v}.end());",
    detail: "sort 排序",
  },
  {
    label: "dfs",
    insertText:
      "void dfs(int ${1:u}) {\n\tvis[${1:u}] = true;\n\tfor (int ${2:v} : adj[${1:u}]) {\n\t\tif (!vis[${2:v}]) {\n\t\t\tdfs(${2:v});\n\t\t}\n\t}\n}",
    detail: "深度优先搜索",
  },
  {
    label: "bfs",
    insertText:
      "void bfs(int ${1:s}) {\n\tqueue<int> q;\n\tq.push(${1:s});\n\tvis[${1:s}] = true;\n\twhile (!q.empty()) {\n\t\tint u = q.front(); q.pop();\n\t\tfor (int v : adj[u]) {\n\t\t\tif (!vis[v]) {\n\t\t\t\tvis[v] = true;\n\t\t\t\tq.push(v);\n\t\t\t}\n\t\t}\n\t}\n}",
    detail: "广度优先搜索",
  },
  {
    label: "struct",
    insertText: "struct ${1:Node} {\n\t${2:int} ${3:x};\n};",
    detail: "struct 定义",
  },
  {
    label: "cin",
    insertText: "cin >> ${1:x};",
    detail: "cin 读入",
  },
  {
    label: "cout",
    insertText: "cout << ${1:x} << endl;",
    detail: "cout 输出",
  },
  {
    label: "freopen",
    insertText:
      'freopen("${1:in}.txt", "r", stdin);\nfreopen("${2:out}.txt", "w", stdout);',
    detail: "文件重定向",
  },
];

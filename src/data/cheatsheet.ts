// C++ 速查表数据 + 类型 + 搜索纯函数
// 内容面向 OI/算法教学，C++17 标准。每条 snippet 必须可通过 clang++ -std=c++17 编译。

export type CheatCategory =
  | "syntax"
  | "io"
  | "string"
  | "container"
  | "algorithm"
  | "template";

export interface CheatSnippet {
  /** 单行或多行代码（必须可编译） */
  code: string;
  /** 行内/段落说明 */
  comment: string;
}

export interface CheatEntry {
  /** 唯一标识，用于 React key */
  id: string;
  category: CheatCategory;
  /** 函数名 / 关键字 / 模板名，如 "printf" */
  name: string;
  /** 一句话标题，如 "格式化输出" */
  title: string;
  /** 作用描述 */
  summary: string;
  /** 隐藏搜索词（中英文、相关函数名），至少 3 个 */
  keywords: string[];
  /** 典型写法，至少 1 条 */
  snippets: CheatSnippet[];
}

export const CHEATSHEET_ENTRIES: CheatEntry[] = [
  // ============== 语法 (syntax) ==============
  {
    id: "data-types",
    category: "syntax",
    name: "基本数据类型",
    title: "整型/浮点/字符/布尔",
    summary: "C++ 基本数据类型及取值范围，OI 中常用 int 和 long long。",
    keywords: ["数据类型", "整型", "浮点", "字符", "布尔", "int", "long long", "double", "char", "bool", "范围", "溢出"],
    snippets: [
      {
        code: 'int a = 100;              // 约 ±2.1×10^9\nlong long b = 10000000000LL; // 约 ±9.2×10^18（末尾加 LL）\ndouble x = 3.14;           // 约 15 位有效数字\nchar c = \'A\';              // 单引号，存 ASCII\nbool flag = true;          // true / false',
        comment: "int 约 21 亿；long long 约 9.2×10^18，字面量加 LL 避免溢出",
      },
      {
        code: '// 常见范围溢出\nint a = 2147483647;     // INT_MAX\na + 1;                  // 溢出，未定义行为\nlong long b = (long long)a * a;  // 先转换再运算',
        comment: "两 int 相乘前必须先转 long long，否则中间结果溢出",
      },
    ],
  },
  {
    id: "branch",
    category: "syntax",
    name: "分支结构",
    title: "if / else / switch / 三目",
    summary: "条件分支：if-else 处理逻辑分支，switch 处理多值匹配，三目运算简洁取值。",
    keywords: ["分支", "条件", "if", "else", "switch", "case", "break", "三目", "三元", "条件运算符"],
    snippets: [
      {
        code: 'if (score >= 90) {\n  grade = \'A\';\n} else if (score >= 60) {\n  grade = \'P\';\n} else {\n  grade = \'F\';\n}',
        comment: "if-else if-else 链，从上到下匹配第一个满足的条件",
      },
      {
        code: 'switch (op) {\n  case 1: cout << "add";    break;\n  case 2: cout << "sub";    break;\n  default: cout << "unknown";  // 可选\n}\n\nint m = (a > b) ? a : b;     // 三目：a>b 成立取 a，否则取 b',
        comment: "switch 每个 case 必须 break；三目运算符适合简单二选一",
      },
    ],
  },
  {
    id: "loop",
    category: "syntax",
    name: "循环结构",
    title: "for / while / do-while",
    summary: "for 已知次数、while 已知条件、do-while 至少执行一次。break 跳出，continue 跳过本次。",
    keywords: ["循环", "for", "while", "do-while", "break", "continue", "嵌套循环", "迭代"],
    snippets: [
      {
        code: '// for：已知次数\nfor (int i = 0; i < n; i++) {\n  cout << i;\n}\n\n// while：已知条件\nwhile (n > 0) {\n  n /= 10;\n  cnt++;\n}\n\n// do-while：至少执行一次\ndo {\n  cin >> x;\n} while (x != 0);',
        comment: "for 最常用；do-while 适合先读再判断的场景",
      },
      {
        code: 'for (int i = 0; i < n; i++) {\n  if (a[i] < 0) continue;   // 跳过负数\n  if (a[i] > 100) break;    // 遇到大数退出\n  sum += a[i];\n}',
        comment: "continue 跳过本次循环体剩余部分；break 直接退出循环",
      },
    ],
  },
  {
    id: "array",
    category: "syntax",
    name: "数组",
    title: "一维 / 二维数组",
    summary: "数组下标从 0 开始，定义时大小必须为常量。二维数组按行存储。",
    keywords: ["数组", "一维数组", "二维数组", "下标", "遍历", "初始化", "memset"],
    snippets: [
      {
        code: 'int a[100];              // 一维数组，下标 0~99\na[0] = 10;\nfor (int i = 0; i < n; i++) {\n  cin >> a[i];\n}\n\nint g[105][105];          // 二维数组\nfor (int i = 0; i < n; i++)\n  for (int j = 0; j < m; j++)\n    cin >> g[i][j];',
        comment: "下标从 0 开始；定义时大小用常量，开大一点防止越界",
      },
      {
        code: 'int a[100] = {0};        // 全部初始化为 0\nmemset(a, 0, sizeof(a));   // 清零（string.h）\nmemset(a, -1, sizeof(a));  // 按字节填充 -1（全 1）',
        comment: "{0} 初始化全 0；memset 按字节填充，仅 0 和 -1 可靠",
      },
    ],
  },
  {
    id: "struct",
    category: "syntax",
    name: "结构体",
    title: "struct 定义与使用",
    summary: "把多个相关变量打包成自定义类型，可含构造函数和成员函数。",
    keywords: ["结构体", "struct", "自定义类型", "成员", "构造函数", "排序", "运算符重载"],
    snippets: [
      {
        code: 'struct Point {\n  int x, y;\n  Point() : x(0), y(0) {}       // 默认构造\n  Point(int x, int y) : x(x), y(y) {}\n};\n\nPoint p(3, 5);\nvector<Point> v;\nv.push_back(Point(1, 2));',
        comment: "构造函数初始化列表；vector 可存结构体",
      },
      {
        code: 'struct Student {\n  string name;\n  int score;\n  bool operator<(const Student& o) const {\n    return score > o.score;      // 降序\n  }\n};\n\nvector<Student> v;\nsort(v.begin(), v.end());      // 按 operator< 排序',
        comment: "重载 < 后可直接 sort，无需自定义比较函数",
      },
    ],
  },
  {
    id: "function",
    category: "syntax",
    name: "函数",
    title: "定义 / 值传递 / 引用传递",
    summary: "函数封装逻辑。值传递不改原值，引用传递可直接修改原变量。",
    keywords: ["函数", "定义", "调用", "值传递", "引用传递", "参数", "返回值", "void", "const引用"],
    snippets: [
      {
        code: '// 值传递：不修改原值\nvoid addOne(int x) {\n  x++;                       // 只改副本\n}\n\n// 引用传递：修改原值\nvoid addOne(int& x) {\n  x++;                       // 改原变量\n}\n\nint n = 5;\naddOne(n);                   // n 仍为 5（值传递）',
        comment: "& 表示引用，直接操作原变量；不加 & 是副本",
      },
      {
        code: '// const 引用：避免拷贝又不修改（常用于 string/vector）\nvoid print(const string& s) {\n  cout << s;                 // 不拷贝，只读\n}\n\nint sum(int a, int b) {\n  return a + b;              // 有返回值\n}',
        comment: "大对象传 const 引用避免拷贝开销；小类型直接值传递",
      },
    ],
  },
  {
    id: "recursion",
    category: "syntax",
    name: "递归",
    title: "函数调用自身",
    summary: "递归把大问题分解为同类小问题，必须有终止条件防止无限递归。",
    keywords: ["递归", "递归调用", "终止条件", "阶乘", "斐波那契", "fib", "factorial", "递归树"],
    snippets: [
      {
        code: '// 阶乘：n! = n × (n-1)!\nlong long factorial(int n) {\n  if (n <= 1) return 1;       // 终止条件\n  return n * factorial(n - 1);\n}\n// factorial(5) = 120',
        comment: "终止条件（base case）必须有，否则栈溢出",
      },
      {
        code: '// 斐波那契：f(n) = f(n-1) + f(n-2)\nint fib(int n) {\n  if (n <= 1) return n;\n  return fib(n - 1) + fib(n - 2);\n}\n// fib(5) = 5：1 1 2 3 5\n// 注意：朴素递归指数级复杂度，n 大时用递推或记忆化',
        comment: "朴素递归有大量重复计算，n 较大时改用递推或记忆化",
      },
    ],
  },
  {
    id: "bitwise",
    category: "syntax",
    name: "位运算",
    title: "& | ^ ~ << >>",
    summary: "位运算直接操作二进制位，常用于状态压缩、快速乘除 2、判断奇偶。",
    keywords: ["位运算", "与", "或", "异或", "取反", "左移", "右移", "状态压缩", "奇偶判断", "快速乘2"],
    snippets: [
      {
        code: 'int a = 12, b = 10;        // 12=1100, 10=1010\na & b;    // 8   (1000) 同时为 1\na | b;    // 14  (1110) 至少一个为 1\na ^ b;    // 6   (0110) 不同为 1\n~a;       // 按位取反\na << 2;   // 48  左移 2 位 = ×4\na >> 2;   // 3   右移 2 位 = ÷4',
        comment: "& 与、| 或、^ 异或、~ 取反、<< 左移、>> 右移",
      },
      {
        code: 'if (n & 1) { /* 奇数 */ }   // 最低位为 1\nn << 1;                    // ×2\nn >> 1;                    // ÷2（向下取整）\nx = x ^ y; y = y ^ x; x = x ^ y;  // 交换两数（不用临时变量）',
        comment: "n&1 判奇偶比 n%2 快；左移右移实现快速乘除 2",
      },
    ],
  },

  // ============== 输入输出 (io) ==============
  {
    id: "printf",
    category: "io",
    name: "printf",
    title: "格式化输出",
    summary: "按指定格式输出数字和文本，常用于控制小数位、补零。",
    keywords: ["格式化输出", "保留小数", "小数位数", "补零", "%d", "%f", "%lf", "%05d"],
    snippets: [
      {
        code: 'printf("%d", 42);\nprintf("%.1f", 3.14);\nprintf("%05d", 42);\nprintf("%s", "hi");',
        comment: "输出 42 / 3.1 / 00042 / hi。%d 整数、%f 浮点、%.nf 保留 n 位、%05d 补零到 5 位",
      },
      {
        code: 'printf("%lf", 3.14);  // 不推荐',
        comment: "scanf 用 %lf，printf 用 %f 即可（C99 起 %lf 与 %f 等价）",
      },
    ],
  },
  {
    id: "scanf",
    category: "io",
    name: "scanf",
    title: "格式化输入",
    summary: "按格式读取输入，double 必须用 %lf，参数须传地址。",
    keywords: ["格式化输入", "读取", "输入", "%d", "%lf", "取地址", "返回值"],
    snippets: [
      {
        code: 'int a;\nscanf("%d", &a);            // 必须加 &\n\ndouble x;\nscanf("%lf", &x);           // double 用 %lf',
        comment: "& 取地址；double 必须用 %lf",
      },
      {
        code: 'int ret = scanf("%d", &a);\nif (ret == EOF) { /* 输入结束 */ }',
        comment: "返回成功读取的项数，EOF 表示输入结束（多组数据常用）",
      },
    ],
  },
  {
    id: "cin-cout",
    category: "io",
    name: "cin / cout",
    title: "流式输入输出",
    summary: "C++ 常用流式 IO，>> 输入、<< 输出，可连写。",
    keywords: ["流式输入输出", "输入流", "输出流", "endl", "读取失败", "EOF"],
    snippets: [
      {
        code: 'int a, b;\ncin >> a >> b;             // 连续读取\ncout << a + b << "\\n";      // 连续输出，换行用 "\\n"',
        comment: ">> 和 << 可连写；\"\\n\" 比 endl 快（不刷新缓冲区）",
      },
      {
        code: 'int a;\nif (!(cin >> a)) {        // 读取失败（EOF 或非法）\n  // 处理结束\n}',
        comment: "cin >> 失败时返回 false，常用于多组数据循环",
      },
    ],
  },
  {
    id: "getline",
    category: "io",
    name: "getline",
    title: "读取整行",
    summary: "读取含空格的一整行；与 cin >> 混用时要先 ignore 残留换行。",
    keywords: ["读取整行", "读一行", "整行输入", "ignore", "空格", "混用"],
    snippets: [
      {
        code: 'string s;\ngetline(cin, s);            // 读整行（含空格）',
        comment: "整行读取，遇到换行符结束",
      },
      {
        code: 'int n;\ncin >> n;\ncin.ignore();             // 必须吃掉残留的换行符\ngetline(cin, s);            // 否则 getline 会读到空行',
        comment: "cin >> 读完数字后留下换行符，getline 会立即读到它",
      },
    ],
  },
  {
    id: "fixed-setprecision",
    category: "io",
    name: "fixed + setprecision",
    title: "浮点精度控制",
    summary: "控制浮点数输出位数，fixed 配合 setprecision(n) 保留 n 位小数。",
    keywords: ["浮点精度", "保留小数", "小数位数", "iomanip", "fixed", "setprecision"],
    snippets: [
      {
        code: '#include <iomanip>\ncout << fixed << setprecision(3) << 3.14159;  // 3.142\n\ncout << 1.0 / 3.0;                              // 0.333（设置持续生效）',
        comment: "fixed + setprecision(3) 保留 3 位小数，设置后持续生效",
      },
    ],
  },
  {
    id: "fast-io",
    category: "io",
    name: "快速输入输出",
    title: "关同步提速",
    summary: "关闭 cin 与 stdio 同步、解绑 cin/cout，配合 \"\\n\" 替代 endl。",
    keywords: ["快速输入输出", "关同步", "提速", "sync_with_stdio", "tie", "endl", "性能"],
    snippets: [
      {
        code: 'int main() {\n  ios::sync_with_stdio(false);\n  cin.tie(0);\n  // 之后用 cin/cout，不要混用 scanf/printf\n  int n;\n  cin >> n;\n  cout << n << "\\n";      // 用 "\\n" 替代 endl\n}',
        comment: "关同步后 cin/cout 大幅提速；endl 会强制刷新缓冲区，用 \"\\n\" 更快",
      },
    ],
  },
  {
    id: "freopen",
    category: "io",
    name: "freopen",
    title: "文件重定向",
    summary: "把 stdin/stdout 重定向到文件，无需改 cin/cout 代码即可读写文件。",
    keywords: ["文件操作", "freopen", "重定向", "文件读", "文件写", "stdin", "stdout", "文件输入输出"],
    snippets: [
      {
        code: '#include <cstdio>\nint main() {\n  freopen("in.txt", "r", stdin);     // 从文件读\n  freopen("out.txt", "w", stdout);    // 写到文件\n  int n;\n  cin >> n;                            // 实际从 in.txt 读\n  cout << n;                           // 实际写到 out.txt\n}',
        comment: "r 读、w 写（覆盖）、a 追加；重定向后 cin/cout 自动指向文件",
      },
    ],
  },

  // ============== 字符串 (string) ==============
  {
    id: "string-length",
    category: "string",
    name: "length / size",
    title: "取字符串长度",
    summary: "返回字符数，length 和 size 完全等价。",
    keywords: ["字符串长度", "长度", "size", "length", "字符数"],
    snippets: [
      {
        code: 'string s = "hello";\nint n = s.length();       // 5\nint m = s.size();         // 5，两者完全等价\n\nfor (int i = 0; i < (int)s.size(); i++) {\n  cout << s[i];           // 下标访问字符\n}',
        comment: "返回 size_t（无符号），与 int 比较时建议显式转换",
      },
    ],
  },
  {
    id: "string-substr",
    category: "string",
    name: "substr",
    title: "取子串",
    summary: "substr(pos) 取到末尾，substr(pos, len) 取指定长度。",
    keywords: ["子串", "取子串", "截取", "substr", "substring"],
    snippets: [
      {
        code: 'string s = "hello world";\nstring a = s.substr(6);       // "world"\nstring b = s.substr(0, 5);    // "hello"',
        comment: "substr(pos) 取到末尾；substr(pos, len) 从 pos 取 len 个字符",
      },
    ],
  },
  {
    id: "string-find",
    category: "string",
    name: "find",
    title: "查找子串或字符",
    summary: "返回首次出现的下标，未找到返回 string::npos。",
    keywords: ["查找", "查找子串", "查找字符", "find", "npos", "首次出现", "位置"],
    snippets: [
      {
        code: 'string s = "hello world";\nsize_t p = s.find("world");   // 6\nsize_t q = s.find(\'o\');        // 4（查找字符）\n\nif (s.find("xyz") == string::npos) {\n  // 未找到\n}',
        comment: "找到返回下标，未找到返回 string::npos",
      },
    ],
  },
  {
    id: "to-string-stoi",
    category: "string",
    name: "to_string / stoi",
    title: "数字与字符串互转",
    summary: "to_string 把数字转字符串，stoi/stol 把字符串转整数。",
    keywords: ["数字转字符串", "字符串转数字", "to_string", "stoi", "stol", "转换"],
    snippets: [
      {
        code: 'string s = to_string(42);      // "42"\nstring t = to_string(3.14);    // "3.140000"\n\nint n = stoi("42");            // 42\nint m = stoi("42abc");         // 42（遇到非法字符停止）\nlong k = stol("1234567890");   // long 类型',
        comment: "stoi 遇到非数字字符停止转换；超范围抛异常",
      },
    ],
  },
  {
    id: "string-compare-concat",
    category: "string",
    name: "string 比较 / 拼接",
    title: "字典序比较与拼接",
    summary: "用比较运算符按字典序比较，用 + / += 拼接字符串。",
    keywords: ["字符串比较", "字符串拼接", "字典序", "比较", "拼接", "加号"],
    snippets: [
      {
        code: 'string a = "apple", b = "banana";\nif (a < b)  { /* 字典序：a < b 成立 */ }\nif (a == "apple") { /* 内容相等 */ }\n\nstring c = a + " " + b;   // "apple banana"\na += "!";                 // "apple!"',
        comment: "string 重载了比较与拼接运算符，按字典序比较",
      },
    ],
  },

  // ============== 容器 (container) ==============
  {
    id: "vector",
    category: "container",
    name: "vector",
    title: "动态数组",
    summary: "支持尾部 O(1) 增删、随机访问，OI 中最常用容器。",
    keywords: ["动态数组", "可变长数组", "vector", "push_back", "尾部添加", "范围for"],
    snippets: [
      {
        code: 'vector<int> v;\nv.push_back(10);            // 尾部添加\nv.push_back(20);\nint n = v.size();           // 2\nv.pop_back();               // 删除末尾\nv[0] = 100;                 // 下标访问（不检查越界）',
        comment: "push_back/pop_back 尾部 O(1)；下标访问不检查越界",
      },
      {
        code: 'for (int x : v) {            // 范围 for 循环遍历\n  cout << x;\n}',
        comment: "范围 for 简化遍历",
      },
    ],
  },
  {
    id: "pair",
    category: "container",
    name: "pair",
    title: "二元组",
    summary: "存储两个值，比较时默认按 first、再按 second 字典序。",
    keywords: ["二元组", "pair", "make_pair", "first", "second", "键值对"],
    snippets: [
      {
        code: 'pair<int, int> p = make_pair(1, 2);\np.first = 10;\np.second = 20;\n\nvector<pair<int, int>> v;\nv.push_back({3, 5});        // 列表初始化\nsort(v.begin(), v.end());   // 默认按 first 升序，first 相同按 second',
        comment: "{a, b} 列表初始化；sort 默认按 first 再按 second 排序",
      },
    ],
  },
  {
    id: "map",
    category: "container",
    name: "map",
    title: "有序映射",
    summary: "按键有序存储键值对，O(log n) 查找/插入。",
    keywords: ["有序映射", "映射", "字典", "map", "键值对", "查找", "有序"],
    snippets: [
      {
        code: 'map<string, int> m;\nm["apple"] = 3;\nm["banana"] = 5;\n\nif (m.count("apple")) {     // 是否存在\n  cout << m["apple"];\n}',
        comment: "[] 操作符不存在时会插入默认值，count 检查是否存在",
      },
      {
        code: 'for (auto& [k, v] : m) {    // C++17 结构化绑定，按键升序\n  cout << k << ":" << v;\n}',
        comment: "按 key 升序遍历；auto& [k, v] 是 C++17 结构化绑定",
      },
    ],
  },
  {
    id: "set",
    category: "container",
    name: "set",
    title: "有序集合",
    summary: "元素唯一且升序，O(log n) 查找/插入/删除。",
    keywords: ["有序集合", "集合", "set", "去重", "insert", "find", "erase", "唯一"],
    snippets: [
      {
        code: 'set<int> s;\ns.insert(3);\ns.insert(1);\ns.insert(3);              // 重复元素不会插入\n\nif (s.count(1)) {         // 是否存在\n  // 1 在集合中\n}\ns.erase(3);               // 按值删除',
        comment: "自动去重并保持升序",
      },
      {
        code: 'for (int x : s) {            // 升序遍历：1\n  cout << x;\n}',
        comment: "遍历顺序为升序",
      },
    ],
  },
  {
    id: "stack-queue-pq",
    category: "container",
    name: "stack / queue / priority_queue",
    title: "栈 / 队列 / 优先队列",
    summary: "stack 后进先出、queue 先进先出、priority_queue 默认大根堆。",
    keywords: ["栈", "队列", "优先队列", "大根堆", "stack", "queue", "priority_queue", "堆"],
    snippets: [
      {
        code: 'stack<int> st;\nst.push(1); st.push(2);\nst.top();                 // 2，栈顶\nst.pop();                 // 弹出栈顶',
        comment: "stack：后进先出，只能访问栈顶",
      },
      {
        code: 'queue<int> q;\nq.push(1); q.push(2);\nq.front();                // 1，队首\nq.pop();                 // 弹出队首',
        comment: "queue：先进先出，访问队首/队尾",
      },
      {
        code: 'priority_queue<int> pq;       // 默认大根堆\npq.push(3); pq.push(1);\npq.top();                 // 3（堆顶最大值）\n\n// 小根堆：priority_queue<int, vector<int>, greater<int>>',
        comment: "默认大根堆；小根堆用 greater<int> 作比较器",
      },
    ],
  },
  {
    id: "deque",
    category: "container",
    name: "deque",
    title: "双端队列",
    summary: "两端 O(1) 增删，支持随机访问。比 vector 多 push_front/pop_front。",
    keywords: ["双端队列", "deque", "push_front", "pop_front", "两端", "双向"],
    snippets: [
      {
        code: 'deque<int> dq;\ndq.push_back(1);            // 尾部加\ndq.push_front(0);           // 头部加\ndq.front();                 // 0\ndq.back();                  // 1\ndq.pop_front();             // 删头部\ndq.pop_back();              // 删尾部',
        comment: "两端 O(1) 操作；支持下标访问 dq[i]",
      },
    ],
  },
  {
    id: "unordered",
    category: "container",
    name: "unordered_map / unordered_set",
    title: "哈希表",
    summary: "基于哈希的容器，O(1) 平均查找，不保证顺序。set/map 的快速版本。",
    keywords: ["哈希表", "unordered_map", "unordered_set", "哈希", "O(1)", "无序", "去重"],
    snippets: [
      {
        code: 'unordered_map<string, int> cnt;\ncnt["apple"] = 3;\ncnt["banana"] = 5;\nif (cnt.count("apple")) {   // O(1) 平均\n  cout << cnt["apple"];\n}\n\nunordered_set<int> s;\ns.insert(1); s.insert(1);    // 去重\ns.size();                    // 1',
        comment: "平均 O(1) 查找；不保证遍历顺序；最坏 O(n) 但极少见",
      },
    ],
  },

  // ============== 算法 / STL (algorithm) ==============
  {
    id: "sort",
    category: "algorithm",
    name: "sort",
    title: "排序",
    summary: "O(n log n) 排序，支持 greater<> 降序和 lambda 自定义比较。",
    keywords: ["排序", "sort", "升序", "降序", "greater", "lambda", "自定义比较"],
    snippets: [
      {
        code: 'vector<int> v = {3, 1, 4, 1, 5};\nsort(v.begin(), v.end());                 // 升序：1 1 3 4 5\nsort(v.begin(), v.end(), greater<int>()); // 降序',
        comment: "greater<int>() 降序；less<int>() 升序（默认）",
      },
      {
        code: 'sort(v.begin(), v.end(), [](int a, int b) {\n  return a > b;                  // 自定义比较：降序\n});',
        comment: "lambda 自定义比较；返回 true 表示 a 应排在 b 前面",
      },
    ],
  },
  {
    id: "min-max-abs-swap",
    category: "algorithm",
    name: "min / max / abs / swap",
    title: "基础工具函数",
    summary: "取最值、绝对值、交换。整型与浮点 abs 的头文件不同。",
    keywords: ["最小值", "最大值", "绝对值", "交换", "min", "max", "abs", "swap", "fabs"],
    snippets: [
      {
        code: 'int a = min(3, 5);          // 3\nint b = max(3, 5);          // 5\nswap(a, b);                 // 交换两变量',
        comment: "min/max 也可用于 initializer_list：max({1, 2, 3})",
      },
      {
        code: 'int c = abs(-7);            // 7（整数，<cstdlib>）\ndouble d = fabs(-3.14);     // 3.14（浮点，<cmath>）\n// 注意：abs(-3.14) 在仅含 <cstdlib> 时会被截断为 3',
        comment: "整数用 cstdlib 的 abs，浮点用 cmath 的 fabs 或 abs",
      },
    ],
  },
  {
    id: "lower-upper-bound",
    category: "algorithm",
    name: "lower_bound / upper_bound",
    title: "二分查找",
    summary: "在有序序列中查找，lower_bound 首个 >=，upper_bound 首个 >。",
    keywords: ["二分查找", "lower_bound", "upper_bound", "有序查找", "二分"],
    snippets: [
      {
        code: 'vector<int> v = {1, 2, 2, 2, 3};\nauto it = lower_bound(v.begin(), v.end(), 2);  // 首个 >= 2\nint idx = it - v.begin();                      // 1\n\nauto it2 = upper_bound(v.begin(), v.end(), 2); // 首个 > 2\nint idx2 = it2 - v.begin();                     // 4',
        comment: "返回迭代器；用 it - v.begin() 转下标",
      },
    ],
  },
  {
    id: "math-functions",
    category: "algorithm",
    name: "数学函数",
    title: "gcd / sqrt / pow / ceil / floor",
    summary: "常用数学函数，pow/ceil/floor 返回 double，赋给 int 可能截断。",
    keywords: ["最大公约数", "gcd", "平方根", "sqrt", "幂", "pow", "向上取整", "ceil", "向下取整", "floor"],
    snippets: [
      {
        code: 'int g = __gcd(12, 8);       // 4（GNU 扩展，OI 常用）\ndouble s = sqrt(2.0);       // 1.414...\ndouble p = pow(2, 10);      // 1024.0（返回 double）',
        comment: "__gcd 是 GNU 扩展（<algorithm>）；C++17 起可用 std::gcd（<numeric>）",
      },
      {
        code: 'double a = ceil(3.2);       // 4.0（向上取整，返回 double）\ndouble b = floor(3.7);      // 3.0（向下取整，返回 double）\nint k = (int)ceil(3.2);     // 4，赋 int 需显式转换',
        comment: "ceil/floor 返回 double；直接赋给 int 可能丢精度",
      },
    ],
  },
  {
    id: "reverse-unique",
    category: "algorithm",
    name: "reverse / unique",
    title: "反转与去重",
    summary: "reverse 反转序列，unique 配合 erase 删除相邻重复元素。",
    keywords: ["反转", "去重", "reverse", "unique", "erase", "相邻重复"],
    snippets: [
      {
        code: 'vector<int> v = {1, 2, 3, 4};\nreverse(v.begin(), v.end());        // 4 3 2 1',
        comment: "reverse 原地反转",
      },
      {
        code: 'vector<int> u = {1, 1, 2, 2, 3};\nsort(u.begin(), u.end());           // unique 前必须有序\nauto last = unique(u.begin(), u.end());\nu.erase(last, u.end());             // 1 2 3',
        comment: "unique 只去相邻重复，需先 sort；返回新末尾迭代器",
      },
    ],
  },
  {
    id: "min-max-element",
    category: "algorithm",
    name: "min_element / max_element",
    title: "最值迭代器",
    summary: "返回指向最小/最大元素的迭代器，用 * 解引用取值。",
    keywords: ["最小元素", "最大元素", "min_element", "max_element", "迭代器", "最值位置"],
    snippets: [
      {
        code: 'vector<int> v = {3, 1, 4, 1, 5};\nauto it1 = min_element(v.begin(), v.end());\nint minVal = *it1;            // 1\nint minIdx = it1 - v.begin();  // 1（下标）\n\nauto it2 = max_element(v.begin(), v.end());\nint maxVal = *it2;            // 5',
        comment: "返回迭代器，用 * 取值、用 - begin() 取下标",
      },
    ],
  },
  {
    id: "accumulate",
    category: "algorithm",
    name: "accumulate",
    title: "求和",
    summary: "对区间求和，需指定初值。整型用 0，浮点用 0.0。",
    keywords: ["求和", "累加", "accumulate", "numeric", "区间和"],
    snippets: [
      {
        code: '#include <numeric>\nvector<int> v = {1, 2, 3, 4, 5};\nint sum = accumulate(v.begin(), v.end(), 0);      // 15\n\nvector<double> d = {1.5, 2.5};\ndouble s = accumulate(d.begin(), d.end(), 0.0);   // 4.0（初值必须 0.0）',
        comment: "初值类型决定累加类型；浮点求和必须用 0.0 而非 0",
      },
    ],
  },
  {
    id: "next-permutation",
    category: "algorithm",
    name: "next_permutation",
    title: "全排列",
    summary: "生成字典序下一个排列，配合 do-while 可枚举所有排列。必须先 sort。",
    keywords: ["全排列", "排列", "next_permutation", "枚举排列", "字典序"],
    snippets: [
      {
        code: 'vector<int> v = {1, 2, 3};\nsort(v.begin(), v.end());     // 必须先排序\n\ndo {\n  for (int x : v) cout << x << " ";\n  cout << "\\n";\n} while (next_permutation(v.begin(), v.end()));\n// 输出：1 2 3 / 1 3 2 / 2 1 3 / ...',
        comment: "do-while 保证第一个排列也输出；返回 false 表示已是最后一个排列",
      },
    ],
  },

  // ============== 模板 (template) ==============
  {
    id: "binary-search",
    category: "template",
    name: "二分查找模板",
    title: "整数二分 + 浮点二分",
    summary: "两种整数写法：l<=r 精确查找、lo<hi 找边界；浮点二分固定循环次数。",
    keywords: ["二分模板", "二分查找", "整数二分", "浮点二分", "lower_bound", "l<=r", "lo<hi", "模板"],
    snippets: [
      {
        code: '// 写法 1：l <= r 精确查找目标值\nint l = 0, r = n - 1;\nwhile (l <= r) {\n  int mid = l + (r - l) / 2;   // 防溢出\n  if (a[mid] == target) {\n    // 找到 target，位置 mid\n    break;\n  } else if (a[mid] < target) {\n    l = mid + 1;\n  } else {\n    r = mid - 1;\n  }\n}',
        comment: "闭区间 [l, r]，l<=r 终止；mid 用 l+(r-l)/2 防溢出",
      },
      {
        code: '// 写法 2：lo < hi 找第一个 >= target 的位置\nint lo = 0, hi = n;           // [0, n)\nwhile (lo < hi) {\n  int mid = (lo + hi) / 2;\n  if (a[mid] >= target) hi = mid;\n  else lo = mid + 1;\n}\n// lo 即答案（lower_bound 风格）',
        comment: "半开区间 [lo, hi)，lo==hi 终止；找边界位置",
      },
      {
        code: '// 浮点二分（保留 6 位小数）\ndouble l = 0, r = 1e9;\nfor (int i = 0; i < 100; i++) {   // 固定循环次数\n  double mid = (l + r) / 2;\n  if (check(mid)) r = mid;\n  else l = mid;\n}',
        comment: "循环 100 次足够精确；比 while (r-l>eps) 更稳",
      },
    ],
  },
  {
    id: "prefix-sum-diff",
    category: "template",
    name: "前缀和 + 差分",
    title: "区间求和 / 区间更新",
    summary: "前缀和 O(1) 查区间和，差分 O(1) 做区间加，最后前缀和还原。",
    keywords: ["前缀和", "差分", "区间求和", "区间更新", "区间加", "模板"],
    snippets: [
      {
        code: '// 一维前缀和：O(1) 查询区间和（1-indexed）\nfor (int i = 1; i <= n; i++)\n  s[i] = s[i - 1] + a[i];\nint sum = s[r] - s[l - 1];     // 区间 [l, r] 的和',
        comment: "1-indexed，边界 s[0]=0 自然处理",
      },
      {
        code: '// 差分：O(1) 区间加，最后前缀和还原\nd[l] += v;  d[r + 1] -= v;     // [l, r] 每个元素加 v\nfor (int i = 1; i <= n; i++)\n  d[i] += d[i - 1];             // 还原为原数组',
        comment: "差分数组前缀和即为修改后的原数组",
      },
    ],
  },
  {
    id: "two-pointers",
    category: "template",
    name: "双指针 / 滑动窗口",
    title: "线性扫描框架",
    summary: "用左右两个指针维护区间，O(n) 解决区间最值/最长/最短问题。",
    keywords: ["双指针", "滑动窗口", "尺取法", "同向双指针", "线性扫描", "模板"],
    snippets: [
      {
        code: '// 同向双指针：维护满足条件的最长区间\nint ans = 0;\nfor (int l = 0, r = 0; r < n; r++) {\n  // 加入 a[r]\n  while (条件不满足 && l <= r) {\n    // 移除 a[l]\n    l++;\n  }\n  ans = max(ans, r - l + 1);\n}',
        comment: "l、r 同向移动，每个元素最多进出各一次，O(n)",
      },
    ],
  },
  {
    id: "direction-array",
    category: "template",
    name: "方向数组",
    title: "DFS/BFS 方向枚举",
    summary: "用 dx[] dy[] 枚举上下左右（或 8 方向），配合越界检查遍历网格。",
    keywords: ["方向数组", "DFS", "BFS", "网格", "上下左右", "dx", "dy", "越界检查", "模板"],
    snippets: [
      {
        code: '// 4 方向：上、下、左、右\nconst int dx[] = {-1, 1, 0, 0};\nconst int dy[] = {0, 0, -1, 1};\n\nvoid dfs(int x, int y) {\n  vis[x][y] = true;\n  for (int i = 0; i < 4; i++) {\n    int nx = x + dx[i], ny = y + dy[i];\n    if (nx < 0 || nx >= n || ny < 0 || ny >= m) continue;\n    if (!vis[nx][ny]) dfs(nx, ny);\n  }\n}',
        comment: "越界检查必须；BFS 用同一组 dx/dy",
      },
      {
        code: '// 8 方向（含对角线）\nconst int dx[] = {-1,-1,-1, 0, 0, 1, 1, 1};\nconst int dy[] = {-1, 0, 1,-1, 1,-1, 0, 1};',
        comment: "8 连通方向数组",
      },
    ],
  },
  {
    id: "enum-simulate",
    category: "template",
    name: "枚举与模拟",
    title: "暴力枚举框架",
    summary: "按题意直接枚举所有可能，不优化但不易错。适合数据范围小的题目。",
    keywords: ["枚举", "模拟", "暴力", "枚举框架", "穷举"],
    snippets: [
      {
        code: '// 枚举所有二元组\nfor (int i = 0; i < n; i++) {\n  for (int j = i + 1; j < n; j++) {\n    // 处理 (a[i], a[j])\n  }\n}\n\n// 枚举数字各位（模拟）\nint x = 12345;\nwhile (x > 0) {\n  int d = x % 10;        // 取末位\n  x /= 10;               // 去掉末位\n}',
        comment: "数据范围小（n≤100）时枚举最稳；模拟按步骤还原过程",
      },
    ],
  },
  {
    id: "simple-sort",
    category: "template",
    name: "简单排序",
    title: "冒泡 / 选择 / 插入",
    summary: "O(n²) 排序，教学用。理解后可直接用 STL sort。",
    keywords: ["冒泡排序", "选择排序", "插入排序", "简单排序", "O(n²)", "排序算法"],
    snippets: [
      {
        code: '// 冒泡：相邻比较，每轮把最大值冒到最后\nfor (int i = 0; i < n - 1; i++)\n  for (int j = 0; j < n - 1 - i; j++)\n    if (a[j] > a[j + 1])\n      swap(a[j], a[j + 1]);',
        comment: "每轮把最大值移到末尾；可加 flag 优化提前退出",
      },
      {
        code: '// 选择：每轮选最小值放到前面\nfor (int i = 0; i < n - 1; i++) {\n  int k = i;\n  for (int j = i + 1; j < n; j++)\n    if (a[j] < a[k]) k = j;\n  swap(a[i], a[k]);\n}\n\n// 插入：把当前元素插入前面已排序部分\nfor (int i = 1; i < n; i++) {\n  int t = a[i], j = i - 1;\n  while (j >= 0 && a[j] > t) { a[j+1] = a[j]; j--; }\n  a[j+1] = t;\n}',
        comment: "选择选最小放前；插入像整理扑克牌",
      },
    ],
  },
  {
    id: "merge-sort",
    category: "template",
    name: "归并排序",
    title: "分治 + 逆序对",
    summary: "O(n log n) 稳定排序，分治思想，可统计逆序对。",
    keywords: ["归并排序", "分治", "稳定排序", "逆序对", "merge", "合并"],
    snippets: [
      {
        code: 'int t[N];  // 临时数组\nvoid mergeSort(int l, int r) {\n  if (l >= r) return;\n  int mid = (l + r) / 2;\n  mergeSort(l, mid);\n  mergeSort(mid + 1, r);\n  // 合并两个有序段\n  int i = l, j = mid + 1, k = l;\n  while (i <= mid && j <= r) {\n    if (a[i] <= a[j]) t[k++] = a[i++];\n    else t[k++] = a[j++];\n  }\n  while (i <= mid) t[k++] = a[i++];\n  while (j <= r)   t[k++] = a[j++];\n  for (int i = l; i <= r; i++) a[i] = t[i];\n}',
        comment: "分治：先排左半、右半，再合并；稳定排序",
      },
      {
        code: '// 统计逆序对：合并时 a[j] < a[i] 则贡献 mid-i+1\n// 在 else 分支加：cnt += mid - i + 1;',
        comment: "a[i] > a[j] 时，i 到 mid 都与 j 构成逆序对",
      },
    ],
  },
  {
    id: "quick-sort",
    category: "template",
    name: "快速排序",
    title: "分治排序",
    summary: "选基准 partition，平均 O(n log n)，最坏 O(n²)。",
    keywords: ["快速排序", "快排", "partition", "分治", "基准", "pivot"],
    snippets: [
      {
        code: 'void quickSort(int l, int r) {\n  if (l >= r) return;\n  int i = l, j = r, pivot = a[(l + r) / 2];\n  while (i <= j) {\n    while (a[i] < pivot) i++;\n    while (a[j] > pivot) j--;\n    if (i <= j) swap(a[i++], a[j--]);\n  }\n  quickSort(l, j);\n  quickSort(i, r);\n}',
        comment: "选中间元素为基准；i<=j 时交换并推进",
      },
    ],
  },
  {
    id: "greedy",
    category: "template",
    name: "贪心",
    title: "区间调度",
    summary: "每步选当前最优。经典：选最多互不重叠区间，按右端点排序。",
    keywords: ["贪心", "贪心算法", "区间调度", "区间选点", "活动选择", "局部最优"],
    snippets: [
      {
        code: '// 选最多互不重叠的区间\nsort(v.begin(), v.end(), [](auto& a, auto& b) {\n  return a.second < b.second;   // 按右端点升序\n});\nint cnt = 0, lastEnd = -1;\nfor (auto& [l, r] : v) {\n  if (l >= lastEnd) {           // 不重叠\n    cnt++;\n    lastEnd = r;\n  }\n}\n// cnt 即最大数量',
        comment: "按右端点排序，选最早结束的；经典贪心策略",
      },
    ],
  },
  {
    id: "recurrence",
    category: "template",
    name: "递推",
    title: "斐波那契递推",
    summary: "用循环代替递归，避免重复计算。O(n) 时间 O(1) 空间。",
    keywords: ["递推", "斐波那契", "fib", "迭代", "动态规划入门", "递推关系"],
    snippets: [
      {
        code: '// 斐波那契递推：f[i] = f[i-1] + f[i-2]\nint f[100];\nf[0] = 0; f[1] = 1;\nfor (int i = 2; i <= n; i++)\n  f[i] = f[i-1] + f[i-2];\n// f[5] = 5\n\n// 滚动变量优化空间\nint a = 0, b = 1;\nfor (int i = 2; i <= n; i++) {\n  int c = a + b;\n  a = b; b = c;\n}',
        comment: "递推比递归高效；滚动变量省空间到 O(1)",
      },
    ],
  },
  {
    id: "dfs",
    category: "template",
    name: "DFS 框架",
    title: "深度优先搜索",
    summary: "递归探索到底再回溯，用 vis 标记避免重复访问。",
    keywords: ["DFS", "深度优先", "搜索", "回溯", "递归", "vis", "标记数组"],
    snippets: [
      {
        code: 'bool vis[N];\nvoid dfs(int u) {\n  vis[u] = true;\n  for (int v : adj[u]) {       // 邻接表\n    if (!vis[v]) dfs(v);\n  }\n}\n\n// 网格 DFS（配合方向数组）\nvoid dfs(int x, int y) {\n  if (x < 0 || x >= n || y < 0 || y >= m) return;\n  if (vis[x][y] || g[x][y] == \'#\') return;\n  vis[x][y] = true;\n  for (int i = 0; i < 4; i++)\n    dfs(x + dx[i], y + dy[i]);\n}',
        comment: "递归到底再回溯；vis 防止重复访问",
      },
    ],
  },
  {
    id: "bfs",
    category: "template",
    name: "BFS 框架",
    title: "广度优先搜索",
    summary: "用队列层序扩展，第一次到达即最短路径（无权图）。",
    keywords: ["BFS", "广度优先", "队列", "层序", "最短路径", "queue"],
    snippets: [
      {
        code: '#include <queue>\nint dist[N];\nvoid bfs(int start) {\n  for (int i = 0; i < N; i++) dist[i] = -1;\n  queue<int> q;\n  q.push(start);\n  dist[start] = 0;\n  while (!q.empty()) {\n    int u = q.front(); q.pop();\n    for (int v : adj[u]) {\n      if (dist[v] == -1) {       // 未访问\n        dist[v] = dist[u] + 1;\n        q.push(v);\n      }\n    }\n  }\n}',
        comment: "dist == -1 表示未访问；BFS 天然求无权图最短路",
      },
    ],
  },
  {
    id: "connected-comp",
    category: "template",
    name: "连通块",
    title: "网格连通块计数",
    summary: "遍历每个格子，遇到未访问的目标点就 DFS/BFS 标记整个连通块。",
    keywords: ["连通块", "连通分量", "网格", "计数", "DFS", "BFS", "flood fill"],
    snippets: [
      {
        code: '// 统计 \'#\' 的连通块数量\nint cnt = 0;\nfor (int i = 0; i < n; i++)\n  for (int j = 0; j < m; j++)\n    if (!vis[i][j] && g[i][j] == \'#\') {\n      cnt++;\n      dfs(i, j);   // 标记整个连通块\n    }\n// cnt 即连通块数',
        comment: "每个未访问的目标点启动一次搜索，统计启动次数",
      },
    ],
  },
  {
    id: "union-find",
    category: "template",
    name: "并查集",
    title: "路径压缩 + 按秩合并",
    summary: "维护等价关系，near O(1) 合并/查询两个元素是否在同一集合。",
    keywords: ["并查集", "union-find", "disjoint set", "路径压缩", "按秩合并", "等价类", "连通分量"],
    snippets: [
      {
        code: 'int fa[N], rk[N];\nvoid init(int n) {\n  for (int i = 1; i <= n; i++) { fa[i] = i; rk[i] = 0; }\n}\n\nint find(int x) {\n  return fa[x] == x ? x : fa[x] = find(fa[x]);  // 路径压缩\n}\n\nvoid unite(int x, int y) {\n  x = find(x); y = find(y);\n  if (x == y) return;\n  if (rk[x] < rk[y]) swap(x, y);   // 按秩合并\n  fa[y] = x;\n  if (rk[x] == rk[y]) rk[x]++;\n}\n\n// 查询：find(x) == find(y)',
        comment: "路径压缩 + 按秩合并，单次操作近似 O(1)",
      },
    ],
  },
  {
    id: "sieve",
    category: "template",
    name: "埃氏筛",
    title: "素数筛",
    summary: "O(n log log n) 筛素数，标记每个素数的倍数为合数。",
    keywords: ["素数筛", "埃氏筛", "埃拉托色尼筛", "质数", "筛法", "sieve"],
    snippets: [
      {
        code: 'bool isPrime[N];       // true 为素数\nvoid sieve(int n) {\n  for (int i = 2; i <= n; i++) isPrime[i] = true;\n  for (int i = 2; i * i <= n; i++) {\n    if (isPrime[i]) {\n      for (int j = i * i; j <= n; j += i)\n        isPrime[j] = false;   // 标记合数\n    }\n  }\n}\n// isPrime[7] == true',
        comment: "从 i*i 开始标记（更小的倍数已被更小素数筛过）",
      },
    ],
  },
  {
    id: "big-integer-add",
    category: "template",
    name: "高精度加法",
    title: "数组模拟大数相加",
    summary: "用数组存大数每一位，从低位到高位相加处理进位。string 读入。",
    keywords: ["高精度", "大数", "大整数", "加法", "进位", "数组模拟", "高精度加法"],
    snippets: [
      {
        code: '#include <string>\n#include <algorithm>\n// 大数加法：返回 a + b 的字符串\nstring add(string a, string b) {\n  string c;\n  int i = a.size() - 1, j = b.size() - 1, carry = 0;\n  while (i >= 0 || j >= 0 || carry) {\n    int x = i >= 0 ? a[i--] - \'0\' : 0;\n    int y = j >= 0 ? b[j--] - \'0\' : 0;\n    int s = x + y + carry;\n    c += (char)(s % 10 + \'0\');\n    carry = s / 10;\n  }\n  reverse(c.begin(), c.end());\n  return c;\n}\n// add("999", "1") = "1000"',
        comment: "从低位（末尾）开始加；carry 处理进位；最后反转",
      },
    ],
  },
  {
    id: "big-integer-div",
    category: "template",
    name: "高精度除法",
    title: "大数除以小整数",
    summary: "大数 A 除以小整数 b（b 在 int 范围），从高位到低位模拟除法。",
    keywords: ["高精度", "大数", "大整数", "除法", "高精度除法", "商", "余数"],
    snippets: [
      {
        code: '// 大数 a 除以小整数 b，返回 {商, 余数}\npair<string, long long> div(string a, long long b) {\n  string q;\n  long long r = 0;\n  for (int i = 0; i < (int)a.size(); i++) {\n    r = r * 10 + (a[i] - \'0\');\n    q += (char)(r / b + \'0\');\n    r %= b;\n  }\n  // 去除前导 0\n  int pos = 0;\n  while (pos < (int)q.size() - 1 && q[pos] == \'0\') pos++;\n  return {q.substr(pos), r};\n}\n// div("1234", 5) = {"246", 4}',
        comment: "从高位（开头）开始除；每次余数 ×10 加下一位；去前导 0",
      },
    ],
  },
  {
    id: "dp-1d",
    category: "template",
    name: "一维 DP",
    title: "爬楼梯",
    summary: "经典一维 DP：f[i] = f[i-1] + f[i-2]，初始化 + 转移 + 答案。",
    keywords: ["动态规划", "DP", "一维DP", "爬楼梯", "斐波那契", "状态转移", "初始化"],
    snippets: [
      {
        code: '// 爬楼梯：每次走 1 或 2 步，走到 n 有多少种\nint f[N];\nf[1] = 1; f[2] = 2;\nfor (int i = 3; i <= n; i++)\n  f[i] = f[i-1] + f[i-2];\n// f[n] 即答案',
        comment: "三步：定义状态、初始化、状态转移方程",
      },
    ],
  },
  {
    id: "knapsack-01",
    category: "template",
    name: "0-1 背包",
    title: "每件物品选或不选",
    summary: "n 件物品每件最多选一次，容量 W 下最大价值。倒序遍历 j。",
    keywords: ["背包", "0-1背包", "01背包", "动态规划", "DP", "容量", "价值"],
    snippets: [
      {
        code: '// n 件物品，容量 W，w[i] 重量 v[i] 价值\nint dp[W + 1] = {0};\nfor (int i = 0; i < n; i++)\n  for (int j = W; j >= w[i]; j--)   // 倒序！\n    dp[j] = max(dp[j], dp[j - w[i]] + v[i]);\n// dp[W] 即最大价值',
        comment: "j 必须倒序，保证每件物品只选一次",
      },
    ],
  },
  {
    id: "knapsack-complete",
    category: "template",
    name: "完全背包",
    title: "物品可重复选取",
    summary: "每件物品可无限次选取，正序遍历 j。与 0-1 背包仅循环方向不同。",
    keywords: ["背包", "完全背包", "动态规划", "DP", "无限物品", "正序"],
    snippets: [
      {
        code: '// n 件物品，容量 W，每件可无限次选\nint dp[W + 1] = {0};\nfor (int i = 0; i < n; i++)\n  for (int j = w[i]; j <= W; j++)   // 正序！\n    dp[j] = max(dp[j], dp[j - w[i]] + v[i]);\n// dp[W] 即最大价值',
        comment: "与 0-1 背包唯一区别：j 正序遍历，允许重复选取",
      },
    ],
  },
  {
    id: "lis",
    category: "template",
    name: "LIS",
    title: "最长上升子序列",
    summary: "O(n²) DP 或 O(n log n) 二分。dp[i] = 以 a[i] 结尾的 LIS 长度。",
    keywords: ["LIS", "最长上升子序列", "动态规划", "DP", "二分", "单调"],
    snippets: [
      {
        code: '// O(n²) DP\nint dp[N], ans = 0;\nfor (int i = 0; i < n; i++) {\n  dp[i] = 1;                  // 至少包含自己\n  for (int j = 0; j < i; j++)\n    if (a[j] < a[i])\n      dp[i] = max(dp[i], dp[j] + 1);\n  ans = max(ans, dp[i]);\n}\n// ans 即 LIS 长度',
        comment: "dp[i] = 以 a[i] 结尾的 LIS；枚举前驱 j",
      },
      {
        code: '// O(n log n) 二分\nvector<int> tail;   // tail[k] = 长度为 k+1 的 LIS 的最小末尾\nfor (int i = 0; i < n; i++) {\n  auto it = lower_bound(tail.begin(), tail.end(), a[i]);\n  if (it == tail.end()) tail.push_back(a[i]);\n  else *it = a[i];\n}\n// tail.size() 即 LIS 长度',
        comment: "维护单调数组，lower_bound 找位置；O(n log n)",
      },
    ],
  },
  {
    id: "lcs",
    category: "template",
    name: "LCS",
    title: "最长公共子序列",
    summary: "二维 DP：dp[i][j] = a[1..i] 与 b[1..j] 的 LCS 长度。",
    keywords: ["LCS", "最长公共子序列", "动态规划", "DP", "二维DP", "公共"],
    snippets: [
      {
        code: '// a[1..n], b[1..m]\nint dp[N][M];\nfor (int i = 1; i <= n; i++)\n  for (int j = 1; j <= m; j++) {\n    if (a[i] == b[j])\n      dp[i][j] = dp[i-1][j-1] + 1;\n    else\n      dp[i][j] = max(dp[i-1][j], dp[i][j-1]);\n  }\n// dp[n][m] 即 LCS 长度',
        comment: "字符相等则 +1；不等则取上/左较大值",
      },
    ],
  },
  {
    id: "linked-list",
    category: "template",
    name: "链表",
    title: "数组模拟单链表",
    summary: "用 val[i] 和 nxt[i] 数组模拟链表，O(1) 插入删除。",
    keywords: ["链表", "单链表", "数组模拟", "val", "nxt", "next", "头插法"],
    snippets: [
      {
        code: 'int val[N], nxt[N], head = -1, idx = 0;\n\n// 头插法\nvoid insertHead(int x) {\n  val[idx] = x;\n  nxt[idx] = head;\n  head = idx++;\n}\n\n// 遍历\nfor (int i = head; i != -1; i = nxt[i])\n  cout << val[i];',
        comment: "head = -1 表示空链表；nxt = -1 表示链表末尾",
      },
    ],
  },
  {
    id: "binary-tree",
    category: "template",
    name: "二叉树遍历",
    title: "前中后序 + 层序",
    summary: "前序根左右、中序左根右、后序左右根；层序用队列 BFS。",
    keywords: ["二叉树", "遍历", "前序", "中序", "后序", "层序", "递归", "BFS"],
    snippets: [
      {
        code: 'struct Node { int val; Node *l, *r; };\n\nvoid preOrder(Node* p) {       // 前序：根左右\n  if (!p) return;\n  cout << p->val;\n  preOrder(p->l);\n  preOrder(p->r);\n}\n\nvoid inOrder(Node* p) {        // 中序：左根右\n  if (!p) return;\n  inOrder(p->l);\n  cout << p->val;\n  inOrder(p->r);\n}\n\nvoid postOrder(Node* p) {      // 后序：左右根\n  if (!p) return;\n  postOrder(p->l);\n  postOrder(p->r);\n  cout << p->val;\n}',
        comment: "前序=先根；中序=中间访问根；后序=最后访问根",
      },
      {
        code: '// 层序（BFS）\nqueue<Node*> q;\nq.push(root);\nwhile (!q.empty()) {\n  Node* p = q.front(); q.pop();\n  cout << p->val;\n  if (p->l) q.push(p->l);\n  if (p->r) q.push(p->r);\n}',
        comment: "用队列逐层访问；BFS 思想",
      },
    ],
  },
];

// 分类元数据：id → label i18n key（保持显示顺序）
export const CHEATSHEET_CATEGORIES: {
  id: CheatCategory | "all";
  labelKey: string;
}[] = [
  { id: "all", labelKey: "cheatsheet.catAll" },
  { id: "syntax", labelKey: "cheatsheet.catSyntax" },
  { id: "io", labelKey: "cheatsheet.catIO" },
  { id: "string", labelKey: "cheatsheet.catString" },
  { id: "container", labelKey: "cheatsheet.catContainer" },
  { id: "algorithm", labelKey: "cheatsheet.catAlgorithm" },
  { id: "template", labelKey: "cheatsheet.catTemplate" },
];

/**
 * 速查表搜索纯函数。
 *
 * 大小写不敏感子串匹配，搜索字段：name + title + summary + keywords + snippets.code。
 * 空 query 时仅按 category 过滤（保持分组浏览）。
 */
export function searchCheatsheet(
  entries: CheatEntry[],
  query: string,
  category: CheatCategory | "all",
): CheatEntry[] {
  const q = query.trim().toLowerCase();
  return entries.filter((e) => {
    if (category !== "all" && e.category !== category) return false;
    if (!q) return true;
    const haystack = [
      e.name,
      e.title,
      e.summary,
      ...e.keywords,
      ...e.snippets.map((s) => s.code),
    ]
      .join("\n")
      .toLowerCase();
    return haystack.includes(q);
  });
}

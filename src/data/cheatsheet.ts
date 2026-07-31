// C++ 速查表数据 + 类型 + 搜索纯函数
// 内容面向 OI/算法教学，C++17 标准。每条 snippet 必须可通过 clang++ -std=c++17 编译。

export type CheatCategory =
  | "io"
  | "syntax"
  | "stl"
  | "algorithm"
  | "dp"
  | "graph";

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
    title: "struct + 聚合初始化",
    summary: "把多个相关变量打包成自定义类型，用聚合初始化 `{}` 简洁构造。",
    keywords: ["结构体", "struct", "自定义类型", "成员", "聚合初始化", "列表初始化", "{}", "花括号"],
    snippets: [
      {
        code: 'struct Point { int x, y; };\nPoint p{3, 5};                      // 聚合初始化\nPoint q = {1, 2};                   // 等价写法\nvector<Point> v = {{1, 2}, {3, 4}}; // 列表初始化',
        comment: "无构造函数时直接用 {} 按成员顺序初始化",
      },
      {
        code: 'struct Student { string name; int score; };\nvector<Student> v = {{"Alice", 90}, {"Bob", 85}};\n// 排序：不重载 <，用 lambda 比较函数\nsort(v.begin(), v.end(), [](const Student& a, const Student& b) {\n  return a.score > b.score;         // 降序\n});',
        comment: "排序用 lambda 比较函数，比运算符重载更灵活",
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

  // ============== STL 容器/算法 (stl) ==============
  {
    id: "string-length",
    category: "stl",
    name: "length / size",
    title: "取字符串长度与容量",
    summary: "返回字符数，length 和 size 完全等价。empty 判空，capacity/reserve 管理容量。",
    keywords: ["字符串长度", "长度", "size", "length", "字符数", "string", "empty", "capacity", "reserve", "resize"],
    snippets: [
      {
        code: 'string s = "hello";\nint n = s.length();       // 5\nint m = s.size();         // 5，两者完全等价\n\nfor (int i = 0; i < (int)s.size(); i++) {\n  cout << s[i];           // 下标访问字符\n}',
        comment: "返回 size_t（无符号），与 int 比较时建议显式转换",
      },
      {
        code: 'string s;\nif (s.empty()) {          // true，空字符串\n  s = "hi";\n}',
        comment: "empty() 返回 bool，等价于 size() == 0 但更清晰",
      },
      {
        code: 'string s = "hello";\ncout << s.capacity();     // 容量（>= 5，实现相关）\ns.reserve(100);           // 预分配至少 100 字符容量\ns.resize(10);             // 长度改为 10，多出位置补 \'\\0\'\ns.resize(3);              // 长度改为 3，截断为 "hel"',
        comment: "capacity 当前容量；reserve 预分配避免多次扩容；resize 改变长度",
      },
    ],
  },
  {
    id: "string-substr",
    category: "stl",
    name: "substr",
    title: "取子串与增删改",
    summary: "substr 取子串；insert/erase/replace 增删改；append/push_back/pop_back 追加删除。",
    keywords: ["子串", "取子串", "截取", "substr", "substring", "string", "insert", "erase", "replace", "append", "push_back", "pop_back", "clear"],
    snippets: [
      {
        code: 'string s = "hello world";\nstring a = s.substr(6);       // "world"\nstring b = s.substr(0, 5);    // "hello"',
        comment: "substr(pos) 取到末尾；substr(pos, len) 从 pos 取 len 个字符",
      },
      {
        code: 'string s = "hello";\ns.insert(2, "XX");      // "heXXllo"，在 pos=2 处插入\ns.erase(2, 2);          // "hello"，从 pos=2 删 2 个字符\ns.replace(0, 2, "HH"); // "HHllo"，替换 pos=0 起 2 个字符为 "HH"',
        comment: "insert 插入；erase(pos, len) 删除；replace(pos, len, str) 替换",
      },
      {
        code: 'string s = "hello";\ns.append(" world");     // "hello world"，末尾追加字符串\ns.push_back(\'!\');       // "hello world!"，末尾追加单字符\ns.pop_back();           // "hello world"，删除末尾字符\ns.clear();              // 清空，s 变为 ""',
        comment: "append 追加字符串；push_back 追加字符；pop_back 删末尾；clear 清空",
      },
    ],
  },
  {
    id: "string-find",
    category: "stl",
    name: "find",
    title: "查找子串或字符",
    summary: "find 从前找、rfind 从后找；find_first_of/not_of 找字符集。未找到返回 npos。",
    keywords: ["查找", "查找子串", "查找字符", "find", "rfind", "find_first_of", "find_first_not_of", "find_last_of", "find_last_not_of", "npos", "首次出现", "位置", "string"],
    snippets: [
      {
        code: 'string s = "hello world";\nsize_t p = s.find("world");   // 6\nsize_t q = s.find(\'o\');        // 4（查找字符）\n\nif (s.find("xyz") == string::npos) {\n  // 未找到\n}',
        comment: "find 从前向后查找，返回下标，未找到返回 string::npos",
      },
      {
        code: 'string s = "hello world";\nsize_t r = s.rfind("o");       // 7，从后向前找最后一个 \'o\'\nsize_t first = s.find_first_of("aeiou");  // 1，第一个元音\nsize_t last = s.find_last_of("aeiou");   // 7，最后一个元音',
        comment: "rfind 反向查找；find_first_of/last_of 在字符集中查找",
      },
      {
        code: 'string s = "  hello  ";\nsize_t a = s.find_first_not_of(" ");  // 2，第一个非空格\nsize_t b = s.find_last_not_of(" ");   // 6，最后一个非空格\nstring trimmed = s.substr(a, b - a + 1);  // "hello"，去首尾空格',
        comment: "find_first_not_of/last_not_of 找不在字符集中的字符，常用于 trim",
      },
    ],
  },
  {
    id: "to-string-stoi",
    category: "stl",
    name: "to_string / stoi",
    title: "数字与字符串互转",
    summary: "to_string 把数字转字符串，stoi/stol 把字符串转整数。",
    keywords: ["数字转字符串", "字符串转数字", "to_string", "stoi", "stol", "转换", "string"],
    snippets: [
      {
        code: 'string s = to_string(42);      // "42"\nstring t = to_string(3.14);    // "3.140000"\n\nint n = stoi("42");            // 42\nint m = stoi("42abc");         // 42（遇到非法字符停止）\nlong k = stol("1234567890");   // long 类型',
        comment: "stoi 遇到非数字字符停止转换；超范围抛异常",
      },
    ],
  },
  {
    id: "string-compare-concat",
    category: "stl",
    name: "string 比较 / 拼接",
    title: "比较、拼接与字符访问",
    summary: "比较运算符按字典序；+ / += 拼接；at/back/front 访问；begin/end 迭代器。",
    keywords: ["字符串比较", "字符串拼接", "字典序", "比较", "拼接", "加号", "string", "compare", "c_str", "data", "at", "back", "front", "begin", "end", "rbegin", "rend"],
    snippets: [
      {
        code: 'string a = "apple", b = "banana";\nif (a < b)  { /* 字典序：a < b 成立 */ }\nif (a == "apple") { /* 内容相等 */ }\n\nstring c = a + " " + b;   // "apple banana"\na += "!";                 // "apple!"',
        comment: "string 重载了比较与拼接运算符，按字典序比较",
      },
      {
        code: 'string s = "hello";\nint r = s.compare("world");   // 负数（s < "world"）\nchar c = s.at(0);              // \'h\'，带边界检查越界抛异常\nchar f = s.front();            // \'h\'，首字符\nchar b = s.back();             // \'o\'，末字符',
        comment: "compare 返回 <0/0/>0；at 带边界检查，front/back 取首尾",
      },
      {
        code: 'string s = "hello";\nconst char* p = s.c_str();    // C 风格字符串（\'\\0\' 结尾）\nconst char* d = s.data();     // 字符数组指针（C++17 起与 c_str 等价）\nprintf("%s", p);               // 可传给 printf\n\nfor (auto it = s.begin(); it != s.end(); ++it) {\n  cout << *it;                 // 正向遍历\n}\nfor (auto rit = s.rbegin(); rit != s.rend(); ++rit) {\n  cout << *rit;                // 反向遍历：olleh\n}',
        comment: "c_str 返回 C 字符串；data 返回字符数组指针；begin/end 正向迭代器；rbegin/rend 反向迭代器",
      },
    ],
  },
  {
    id: "vector",
    category: "stl",
    name: "vector",
    title: "动态数组",
    summary: "支持尾部 O(1) 增删、随机访问，OI 中最常用容器。",
    keywords: ["动态数组", "可变长数组", "vector", "push_back", "emplace_back", "尾部添加", "范围for", "insert", "erase", "resize", "reserve", "capacity", "at", "front", "back", "empty", "clear", "begin", "end"],
    snippets: [
      {
        code: 'vector<int> v;\nv.push_back(10);            // 尾部添加\nv.emplace_back(20);         // 尾部原位构造（更高效）\nint n = v.size();           // 2\nv.pop_back();               // 删除末尾\nv[0] = 100;                 // 下标访问（不检查越界）',
        comment: "push_back/emplace_back 尾部 O(1)；emplace_back 避免临时对象",
      },
      {
        code: 'vector<int> v = {1, 2, 3};\nv.insert(v.begin() + 1, 99);  // 在 pos=1 插入 99：{1,99,2,3}\nv.erase(v.begin());           // 删除 pos=0：{99,2,3}\nv.clear();                    // 清空，size=0 但 capacity 不变\nif (v.empty()) { /* true */ }',
        comment: "insert/erase 指定位置 O(n)；clear 清空；empty 判空",
      },
      {
        code: 'vector<int> v;\nv.resize(5);              // 长度改为 5，新元素初始化为 0\nv.resize(3);              // 长度改为 3，截断\nv.reserve(100);           // 预分配容量，避免多次扩容\ncout << v.capacity();     // 当前容量（>= 100）',
        comment: "resize 改变 size；reserve 改变 capacity 不改变 size",
      },
      {
        code: 'vector<int> v = {10, 20, 30};\nint a = v.front();        // 10，首元素\nint b = v.back();         // 30，末元素\nint c = v.at(1);          // 20，带边界检查越界抛异常\n\nfor (auto it = v.begin(); it != v.end(); ++it) {\n  cout << *it;            // 正向遍历\n}\nfor (int x : v) {         // 范围 for 简化遍历\n  cout << x;\n}',
        comment: "front/back/at 访问；begin/end 迭代器；范围 for 遍历",
      },
    ],
  },
  {
    id: "pair",
    category: "stl",
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
    category: "stl",
    name: "map",
    title: "有序映射",
    summary: "按键有序存储键值对，O(log n) 查找/插入。支持 lower_bound/upper_bound 区间查询。",
    keywords: ["有序映射", "映射", "字典", "map", "键值对", "查找", "有序", "insert", "erase", "find", "count", "empty", "clear", "at", "lower_bound", "upper_bound", "begin", "end"],
    snippets: [
      {
        code: 'map<string, int> m;\nm["apple"] = 3;\nm["banana"] = 5;\nm.insert({"cherry", 2});    // 插入键值对\n\nif (m.count("apple")) {     // 是否存在（0 或 1）\n  cout << m["apple"];        // 3\n}\nm.at("banana") = 10;        // at 带边界检查越界抛异常\nm.erase("apple");           // 按键删除',
        comment: "[] 不存在时插入默认值；count 检查存在；at 带检查；erase 删除",
      },
      {
        code: 'map<string, int> m = {{"a", 1}, {"c", 3}, {"e", 5}};\nauto it = m.find("c");      // 查找，未找到返回 m.end()\nif (it != m.end()) cout << it->second;  // 3\n\nauto lo = m.lower_bound("b"); // 首个 key >= "b" 的迭代器（指向 "c"）\nauto hi = m.upper_bound("d"); // 首个 key > "d" 的迭代器（指向 "e"）\n// [lo, hi) 即 key 在 ["b","d"] 区间的元素',
        comment: "find 查找；lower_bound >= key；upper_bound > key，用于区间查询",
      },
      {
        code: 'map<string, int> m = {{"a", 1}, {"b", 2}};\ncout << m.size();           // 2\nfor (auto& [k, v] : m) {    // C++17 结构化绑定，按键升序\n  cout << k << ":" << v;\n}\n\nm.clear();                  // 清空\nif (m.empty()) { /* true */ }\n// for (auto it = m.begin(); it != m.end(); ++it) { ... }  迭代器遍历',
        comment: "size 返回元素数；结构化绑定按 key 升序遍历；clear 清空；empty 判空；begin/end 迭代器",
      },
    ],
  },
  {
    id: "set",
    category: "stl",
    name: "set",
    title: "有序集合",
    summary: "元素唯一且升序，O(log n) 查找/插入/删除。支持 lower_bound/upper_bound 区间查询。",
    keywords: ["有序集合", "集合", "set", "去重", "insert", "find", "erase", "count", "empty", "clear", "lower_bound", "upper_bound", "begin", "end", "唯一"],
    snippets: [
      {
        code: 'set<int> s;\ns.insert(3);\ns.insert(1);\ns.insert(3);              // 重复元素不会插入\n\nif (s.count(1)) {         // 是否存在（0 或 1）\n  // 1 在集合中\n}\nauto it = s.find(3);      // 查找，未找到返回 s.end()\ns.erase(3);               // 按值删除',
        comment: "insert 插入；count/find 查找；erase 按值删除",
      },
      {
        code: 'set<int> s = {1, 3, 5, 7, 9};\nauto lo = s.lower_bound(3);  // 首个 >= 3 的迭代器（指向 3）\nauto hi = s.upper_bound(7);  // 首个 > 7 的迭代器（指向 9）\n// [lo, hi) 即值在 [3,7] 区间的元素：3,5,7\nfor (auto it = lo; it != hi; ++it) {\n  cout << *it;\n}',
        comment: "lower_bound >= val；upper_bound > val，用于区间查询",
      },
      {
        code: 'set<int> s = {1, 2, 3};\ncout << s.size();           // 3\nfor (int x : s) {            // 升序遍历：1 2 3\n  cout << x;\n}\ns.clear();                  // 清空\nif (s.empty()) { /* true */ }\n// for (auto it = s.begin(); it != s.end(); ++it) { ... }  迭代器遍历',
        comment: "size 返回元素数；升序遍历；clear 清空；empty 判空；begin/end 迭代器",
      },
    ],
  },
  {
    id: "stack-queue-pq",
    category: "stl",
    name: "stack / queue / priority_queue",
    title: "栈 / 队列 / 优先队列",
    summary: "stack 后进先出、queue 先进先出、priority_queue 默认大根堆。均有 size/empty。",
    keywords: ["栈", "队列", "优先队列", "大根堆", "stack", "queue", "priority_queue", "堆", "push", "pop", "top", "front", "back", "size", "empty"],
    snippets: [
      {
        code: 'stack<int> st;\nst.push(1); st.push(2);\nst.top();                 // 2，栈顶\ncout << st.size();         // 2\nst.pop();                 // 弹出栈顶\nif (st.empty()) { /* false */ }',
        comment: "stack：后进先出，只能访问栈顶；size/empty 通用",
      },
      {
        code: 'queue<int> q;\nq.push(1); q.push(2);\nq.front();                // 1，队首\nq.back();                 // 2，队尾\ncout << q.size();         // 2\nq.pop();                 // 弹出队首\nif (q.empty()) { /* false */ }',
        comment: "queue：先进先出，访问队首/队尾；size/empty 通用",
      },
      {
        code: 'priority_queue<int> pq;       // 默认大根堆\npq.push(3); pq.push(1);\npq.top();                 // 3（堆顶最大值）\ncout << pq.size();        // 2\npq.pop();                 // 弹出堆顶\n// 小根堆：priority_queue<int, vector<int>, greater<int>>',
        comment: "默认大根堆；小根堆用 greater<int>；size/empty 通用",
      },
    ],
  },
  {
    id: "deque",
    category: "stl",
    name: "deque",
    title: "双端队列",
    summary: "两端 O(1) 增删，支持随机访问。比 vector 多 push_front/pop_front。",
    keywords: ["双端队列", "deque", "push_front", "pop_front", "push_back", "pop_back", "emplace_back", "insert", "erase", "resize", "at", "front", "back", "empty", "clear", "size", "begin", "end", "两端", "双向"],
    snippets: [
      {
        code: 'deque<int> dq;\ndq.push_back(1);            // 尾部加\ndq.push_front(0);           // 头部加\ndq.emplace_back(2);         // 尾部原位构造\nint a = dq.front();         // 0\ndq.pop_front();             // 删头部\ndq.pop_back();              // 删尾部',
        comment: "两端 O(1) 增删；push_front/pop_front 是 deque 独有",
      },
      {
        code: 'deque<int> dq = {1, 2, 3};\ndq.insert(dq.begin() + 1, 99);  // 在 pos=1 插入：{1,99,2,3}\ndq.erase(dq.begin());           // 删除 pos=0：{99,2,3}\ndq.resize(5);                   // 长度改为 5\nint x = dq.at(1);               // 带边界检查\ndq.clear();                     // 清空\nif (dq.empty()) { /* true */ }',
        comment: "insert/erase 任意位置 O(n)；resize/at/clear/empty 同 vector",
      },
      {
        code: 'deque<int> dq = {10, 20, 30};\ncout << dq.size();          // 3\ncout << dq[0];              // 10，下标访问\nfor (auto it = dq.begin(); it != dq.end(); ++it) {\n  cout << *it;              // 迭代器遍历\n}\nfor (int x : dq) {          // 范围 for\n  cout << x;\n}',
        comment: "size/下标访问/迭代器/范围 for 均支持，与 vector 一致",
      },
    ],
  },
  {
    id: "unordered",
    category: "stl",
    name: "unordered_map / unordered_set",
    title: "哈希表",
    summary: "基于哈希的容器，O(1) 平均查找，不保证顺序。set/map 的快速版本，不支持 lower_bound。",
    keywords: ["哈希表", "unordered_map", "unordered_set", "哈希", "O(1)", "无序", "去重", "insert", "erase", "find", "count", "empty", "clear", "at", "begin", "end", "size"],
    snippets: [
      {
        code: 'unordered_map<string, int> cnt;\ncnt["apple"] = 3;\ncnt.insert({"banana", 5});\nif (cnt.count("apple")) {   // O(1) 平均\n  cout << cnt["apple"];      // 3\n}\nauto it = cnt.find("banana");\nif (it != cnt.end()) cout << it->second;  // 5\ncout << cnt.size();         // 2\ncnt.erase("apple");         // 按键删除\ncnt.clear();\nif (cnt.empty()) { /* true */ }',
        comment: "unordered_map：[]/insert/count/find/erase/size/clear/empty；O(1) 平均",
      },
      {
        code: 'unordered_set<int> s;\ns.insert(1); s.insert(2); s.insert(1);  // 去重\nif (s.count(1)) { /* 存在 */ }\nauto it = s.find(2);        // 查找\nif (it != s.end()) s.erase(it);  // 删除\nfor (auto it = s.begin(); it != s.end(); ++it) {\n  cout << *it;               // 顺序不保证\n}\n// 注意：unordered_set/map 不支持 lower_bound/upper_bound',
        comment: "unordered_set：insert/count/find/erase/begin/end；不保证顺序，无 lower/upper_bound",
      },
    ],
  },
  {
    id: "sort",
    category: "stl",
    name: "sort",
    title: "排序",
    summary: "O(n log n) 排序，支持 greater<> 降序和 lambda 自定义比较。",
    keywords: ["排序", "sort", "升序", "降序", "greater", "lambda", "自定义比较", "operator<"],
    snippets: [
      {
        code: 'vector<int> v = {3, 1, 4, 1, 5};\nsort(v.begin(), v.end());                 // 升序：1 1 3 4 5\nsort(v.begin(), v.end(), greater<int>()); // 降序',
        comment: "greater<int>() 降序；less<int>() 升序（默认）",
      },
      {
        code: 'sort(v.begin(), v.end(), [](int a, int b) {\n  return a > b;                  // 自定义比较：降序\n});',
        comment: "lambda 自定义比较；返回 true 表示 a 应排在 b 前面",
      },
      {
        code: '// 结构体排序：用 lambda 比较函数（推荐，比运算符重载更灵活）\nstruct Student { string name; int score; };\nvector<Student> v = {{"Alice", 90}, {"Bob", 85}};\nsort(v.begin(), v.end(), [](const Student& a, const Student& b) {\n  return a.score > b.score;       // 按 score 降序\n});',
        comment: "lambda 比较函数适合一次性排序；多次排序可重载 operator<",
      },
    ],
  },
  {
    id: "min-max-abs-swap",
    category: "stl",
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
    category: "stl",
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
    category: "stl",
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
    category: "stl",
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
    category: "stl",
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
    category: "stl",
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
    category: "stl",
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
  {
    id: "linked-list",
    category: "stl",
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

  // ============== 常用算法 (algorithm) ==============
  {
    id: "binary-search",
    category: "algorithm",
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
    category: "algorithm",
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
    category: "algorithm",
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
    category: "algorithm",
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
    category: "algorithm",
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
    category: "algorithm",
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
    category: "algorithm",
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
    category: "algorithm",
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
    id: "bucket-sort",
    category: "algorithm",
    name: "桶排序",
    title: "分桶 + 桶内排序",
    summary: "把元素按值域分到若干桶，每桶内部排序后合并。O(n) 当桶数≈元素数且分布均匀。",
    keywords: ["桶排序", "分桶", "值域", "bucketsort", "非比较排序"],
    snippets: [
      {
        code: '// 桶排序：a[0..n-1] 值在 [0, MAX)\nconst int BUCKETS = 100;\nvector<int> bucket[BUCKETS];\nfor (int i = 0; i < n; i++) {\n  int b = a[i] * BUCKETS / (MAX + 1);  // 映射到桶\n  bucket[b].push_back(a[i]);\n}\nint k = 0;\nfor (int i = 0; i < BUCKETS; i++) {\n  sort(bucket[i].begin(), bucket[i].end());\n  for (int x : bucket[i]) a[k++] = x;\n}',
        comment: "值域分桶，桶内排序；分布均匀时近似 O(n)",
      },
    ],
  },
  {
    id: "radix-sort",
    category: "algorithm",
    name: "基数排序",
    title: "按位 LSD 排序",
    summary: "从低位到高位依次按位稳定排序（计数排序为子过程）。O(d·(n+k))。",
    keywords: ["基数排序", "LSD", "按位", "稳定排序", "radixsort", "非比较排序"],
    snippets: [
      {
        code: '// LSD 基数排序（非负整数）\nint tmp[N], cnt[10];\nvoid radixSort(int* a, int n) {\n  int mx = *max_element(a, a + n);\n  for (int exp = 1; mx / exp > 0; exp *= 10) {\n    for (int i = 0; i < 10; i++) cnt[i] = 0;\n    for (int i = 0; i < n; i++) cnt[(a[i] / exp) % 10]++;\n    for (int i = 1; i < 10; i++) cnt[i] += cnt[i - 1];\n    for (int i = n - 1; i >= 0; i--) {\n      int d = (a[i] / exp) % 10;\n      tmp[--cnt[d]] = a[i];\n    }\n    for (int i = 0; i < n; i++) a[i] = tmp[i];\n  }\n}',
        comment: "从个位起逐位稳定排序；cnt 倒序填充保持稳定性",
      },
    ],
  },
  {
    id: "counting-sort",
    category: "algorithm",
    name: "计数排序",
    title: "值域计数统计",
    summary: "值域较小时 O(n+k) 排序。统计每个值出现次数再前缀和定位。",
    keywords: ["计数排序", "值域", "前缀和", "countingsort", "非比较排序", "桶计数"],
    snippets: [
      {
        code: '// 计数排序：a[0..n-1] 值在 [0, K)\nint cnt[K + 1] = {0};\nfor (int i = 0; i < n; i++) cnt[a[i]]++;\nfor (int i = 1; i <= K; i++) cnt[i] += cnt[i - 1];\nint tmp[N];\nfor (int i = n - 1; i >= 0; i--) {\n  tmp[--cnt[a[i]]] = a[i];  // 倒序保证稳定\n}\nfor (int i = 0; i < n; i++) a[i] = tmp[i];',
        comment: "值域 K 较小时高效；倒序填充保证稳定性",
      },
    ],
  },
  {
    id: "heap-sort",
    category: "algorithm",
    name: "堆排序",
    title: "建堆 + 逐步取顶",
    summary: "O(n log n) 不稳定排序。建大根堆后反复取堆顶放到末尾。理解 priority_queue 原理。",
    keywords: ["堆排序", "大根堆", "堆调整", "heapsort", "priority_queue", "下沉"],
    snippets: [
      {
        code: '// 堆排序（升序，建大根堆）\nvoid heapify(int* a, int n, int i) {\n  int largest = i, l = 2*i+1, r = 2*i+2;\n  if (l < n && a[l] > a[largest]) largest = l;\n  if (r < n && a[r] > a[largest]) largest = r;\n  if (largest != i) {\n    swap(a[i], a[largest]);\n    heapify(a, n, largest);  // 继续下沉\n  }\n}\nvoid heapSort(int* a, int n) {\n  for (int i = n/2 - 1; i >= 0; i--) heapify(a, n, i);  // 建堆\n  for (int i = n - 1; i > 0; i--) {\n    swap(a[0], a[i]);   // 堆顶放到末尾\n    heapify(a, i, 0);   // 调整剩余部分\n  }\n}',
        comment: "从 n/2-1 倒序建堆；每轮把堆顶换到末尾再下沉",
      },
    ],
  },
  {
    id: "divide-conquer",
    category: "algorithm",
    name: "分治",
    title: "分解 + 递归求解 + 合并",
    summary: "把大问题分解为同类子问题递归求解，最后合并结果。经典：归并、快速幂、最大子段和。",
    keywords: ["分治", "分解", "递归", "合并", "快速幂", "最大子段和", "divide and conquer"],
    snippets: [
      {
        code: '// 快速幂：a^b mod p，O(log b)\nlong long qpow(long long a, long long b, long long p) {\n  long long r = 1; a %= p;\n  while (b > 0) {\n    if (b & 1) r = r * a % p;\n    a = a * a % p;\n    b >>= 1;\n  }\n  return r;\n}',
        comment: "每次把指数折半，底数平方；b&1 处理奇数情况",
      },
      {
        code: '// 最大子段和：分治 O(n log n)\n// 跨中点最大和 = 左半从 mid 向左延伸最大 + 右半从 mid+1 向右延伸最大\nint maxSub(int l, int r) {\n  if (l == r) return a[l];\n  int mid = (l + r) / 2;\n  int L = maxSub(l, mid), R = maxSub(mid + 1, r);\n  int ls = -1e9, rs = -1e9, s = 0;\n  for (int i = mid; i >= l; i--) { s += a[i]; ls = max(ls, s); }\n  s = 0;\n  for (int i = mid + 1; i <= r; i++) { s += a[i]; rs = max(rs, s); }\n  return max({L, R, ls + rs});\n}',
        comment: "三分：左半、右半、跨中点；教学经典分治例题",
      },
    ],
  },
  {
    id: "binary-lifting",
    category: "algorithm",
    name: "倍增 + ST 表",
    title: "预处理 2^k 跳跃",
    summary: "预处理 2 的幂次跳跃信息，O(n log n) 预处理 O(1) 查询区间最值。",
    keywords: ["倍增", "ST表", "稀疏表", "区间最值", "RMQ", "跳跃", "binary lifting"],
    snippets: [
      {
        code: '// ST 表：O(n log n) 预处理，O(1) 查询区间最大值\nint st[N][21];  // st[i][k] = [i, i+2^k-1] 的最大值\nint lg2[N];\nvoid build(int* a, int n) {\n  for (int i = 1; i <= n; i++) st[i][0] = a[i];\n  for (int k = 1; (1 << k) <= n; k++)\n    for (int i = 1; i + (1 << k) - 1 <= n; i++)\n      st[i][k] = max(st[i][k-1], st[i + (1 << (k-1))][k-1]);\n  lg2[1] = 0;\n  for (int i = 2; i <= n; i++) lg2[i] = lg2[i/2] + 1;\n}\nint query(int l, int r) {\n  int k = lg2[r - l + 1];\n  return max(st[l][k], st[r - (1 << k) + 1][k]);\n}',
        comment: "区间可重复贡献（max/min）；lg2 预处理 log2",
      },
    ],
  },
  {
    id: "greedy",
    category: "algorithm",
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
    id: "dfs",
    category: "algorithm",
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
    category: "algorithm",
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
    category: "algorithm",
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
    id: "sieve",
    category: "algorithm",
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
    category: "algorithm",
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
    category: "algorithm",
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

  // ============== 动态规划 (dp) ==============
  {
    id: "memoized-search",
    category: "dp",
    name: "记忆化搜索",
    title: "递归 + 缓存避免重复计算",
    summary: "自顶向下递归配合备忘录，把朴素递归指数级复杂度降到多项式。本质等于 DP。",
    keywords: ["记忆化搜索", "备忘录", "memo", "递归", "自顶向下", "fib"],
    snippets: [
      {
        code: '// 记忆化斐波那契：O(n)\nint memo[100];\nmemset(memo, -1, sizeof(memo));\nint fib(int n) {\n  if (n <= 1) return n;\n  if (memo[n] != -1) return memo[n];  // 已计算\n  return memo[n] = fib(n-1) + fib(n-2);\n}',
        comment: "进入函数先查 memo；返回前写入 memo",
      },
    ],
  },
  {
    id: "knapsack-dp",
    category: "dp",
    name: "背包DP",
    title: "0-1 背包 + 完全背包",
    summary: "0-1 背包每件选一次（倒序），完全背包每件可选无限次（正序）。仅循环方向不同。",
    keywords: ["背包", "0-1背包", "01背包", "完全背包", "动态规划", "DP", "容量", "价值"],
    snippets: [
      {
        code: '// 0-1 背包：每件物品最多选一次\nint dp[W + 1] = {0};\nfor (int i = 0; i < n; i++)\n  for (int j = W; j >= w[i]; j--)   // 倒序！\n    dp[j] = max(dp[j], dp[j - w[i]] + v[i]);\n// dp[W] 即最大价值',
        comment: "j 必须倒序，保证每件物品只选一次",
      },
      {
        code: '// 完全背包：每件物品可无限次选\nint dp[W + 1] = {0};\nfor (int i = 0; i < n; i++)\n  for (int j = w[i]; j <= W; j++)   // 正序！\n    dp[j] = max(dp[j], dp[j - w[i]] + v[i]);\n// dp[W] 即最大价值',
        comment: "与 0-1 背包唯一区别：j 正序遍历，允许重复选取",
      },
    ],
  },
  {
    id: "interval-dp",
    category: "dp",
    name: "区间DP",
    title: "石子合并",
    summary: "枚举区间长度和分割点，dp[l][r] 表示区间 [l,r] 的最优解。",
    keywords: ["区间DP", "石子合并", "合并", "区间", "动态规划", "DP", "分割点"],
    snippets: [
      {
        code: '// 石子合并：n 堆石子排成一排，每次合并相邻两堆，代价为两堆之和\nint dp[N][N], s[N];  // s 为前缀和\nfor (int len = 2; len <= n; len++) {       // 枚举区间长度\n  for (int l = 1; l + len - 1 <= n; l++) {\n    int r = l + len - 1;\n    dp[l][r] = INT_MAX;\n    for (int k = l; k < r; k++) {          // 枚举分割点\n      dp[l][r] = min(dp[l][r],\n        dp[l][k] + dp[k+1][r] + s[r] - s[l-1]);\n    }\n  }\n}\n// dp[1][n] 即最小总代价',
        comment: "len 从小到大保证子区间已算好；s[r]-s[l-1] 为合并代价",
      },
    ],
  },
  {
    id: "tree-dp",
    category: "dp",
    name: "树形DP",
    title: "没有上司的舞会",
    summary: "在树上做 DP，常用 dp[u][0/1] 表示 u 子树选/不选 u 的最优解。",
    keywords: ["树形DP", "树DP", "没有上司的舞会", "独立集", "动态规划", "DP", "子树"],
    snippets: [
      {
        code: '// 没有上司的舞会：选了 u 不能选其直接下属，求最大快乐值\nint h[N], dp[N][2];  // dp[u][0]=不选u, dp[u][1]=选u\nvector<int> child[N];\nvoid dfs(int u) {\n  dp[u][0] = 0;\n  dp[u][1] = h[u];\n  for (int v : child[u]) {\n    dfs(v);\n    dp[u][0] += max(dp[v][0], dp[v][1]);  // 不选 u，下属可选可不选\n    dp[u][1] += dp[v][0];                 // 选 u，下属必不选\n  }\n}\n// 根 root 求解后：max(dp[root][0], dp[root][1])',
        comment: "后序遍历；dp[u][1] 必须加 dp[v][0]",
      },
    ],
  },
  {
    id: "linear-dp",
    category: "dp",
    name: "线性DP",
    title: "爬楼梯 + LIS + LCS",
    summary: "状态沿一维或二维线性推进。经典：爬楼梯、最长上升子序列、最长公共子序列。",
    keywords: ["线性DP", "爬楼梯", "LIS", "LCS", "最长上升子序列", "最长公共子序列", "斐波那契", "递推"],
    snippets: [
      {
        code: '// 爬楼梯：每次走 1 或 2 步，走到 n 有多少种\nint f[N];\nf[1] = 1; f[2] = 2;\nfor (int i = 3; i <= n; i++)\n  f[i] = f[i-1] + f[i-2];\n// f[n] 即答案\n\n// 滚动变量优化空间\nint a = 0, b = 1;\nfor (int i = 2; i <= n; i++) {\n  int c = a + b; a = b; b = c;\n}',
        comment: "三步：定义状态、初始化、状态转移方程",
      },
      {
        code: '// LIS 最长上升子序列 O(n²)\nint dp[N], ans = 0;\nfor (int i = 0; i < n; i++) {\n  dp[i] = 1;\n  for (int j = 0; j < i; j++)\n    if (a[j] < a[i]) dp[i] = max(dp[i], dp[j] + 1);\n  ans = max(ans, dp[i]);\n}\n\n// O(n log n) 二分\nvector<int> tail;\nfor (int i = 0; i < n; i++) {\n  auto it = lower_bound(tail.begin(), tail.end(), a[i]);\n  if (it == tail.end()) tail.push_back(a[i]);\n  else *it = a[i];\n}\n// tail.size() 即 LIS 长度',
        comment: "dp[i] = 以 a[i] 结尾的 LIS；tail 维护长度 k+1 的最小末尾",
      },
      {
        code: '// LCS 最长公共子序列\nint dp[N][M];\nfor (int i = 1; i <= n; i++)\n  for (int j = 1; j <= m; j++) {\n    if (a[i] == b[j]) dp[i][j] = dp[i-1][j-1] + 1;\n    else dp[i][j] = max(dp[i-1][j], dp[i][j-1]);\n  }\n// dp[n][m] 即 LCS 长度',
        comment: "字符相等则 +1；不等则取上/左较大值",
      },
    ],
  },
  {
    id: "bitmask-dp",
    category: "dp",
    name: "状压DP",
    title: "TSP 旅行商",
    summary: "用二进制位压缩集合状态，dp[s][i] 表示已访问集合 s、当前在 i 的最优解。",
    keywords: ["状压DP", "状态压缩", "位运算", "TSP", "旅行商", "哈密顿路径", "动态规划"],
    snippets: [
      {
        code: '// TSP：从 0 出发访问所有点各一次回到 0 的最小代价\n// dp[s][i] = 已访问集合 s、当前在 i 的最小代价\nint dp[1 << N][N];\nmemset(dp, 0x3f, sizeof(dp));\ndp[1][0] = 0;  // 起点：只访问 0\nfor (int s = 1; s < (1 << n); s++) {\n  for (int i = 0; i < n; i++) if (s >> i & 1) {\n    for (int j = 0; j < n; j++) if (!(s >> j & 1)) {\n      dp[s | (1 << j)][j] = min(dp[s | (1 << j)][j],\n        dp[s][i] + w[i][j]);\n    }\n  }\n}\n// 答案：min(dp[(1<<n)-1][i] + w[i][0])',
        comment: "n ≤ 20 可行；s|1<<j 表示加入 j；最后回到起点",
      },
    ],
  },
  {
    id: "digit-dp",
    category: "dp",
    name: "数位DP",
    title: "统计区间数字个数",
    summary: "按数字每一位做 DP，常用于统计 [1, n] 中满足条件的数字个数。记忆化递归实现。",
    keywords: ["数位DP", "数位", "数字统计", "区间计数", "动态规划", "DP", "前导零", "上界"],
    snippets: [
      {
        code: '// 数位 DP：统计 [1, n] 中不含连续 9 的数字个数\n// 记忆化递归\nint dig[20], dp[20][2][10];  // pos, limit, last\nint dfs(int pos, bool limit, int last) {\n  if (pos < 0) return 1;\n  if (dp[pos][limit][last] >= 0) return dp[pos][limit][last];\n  int up = limit ? dig[pos] : 9;\n  int res = 0;\n  for (int d = 0; d <= up; d++) {\n    if (last == 9 && d == 9) continue;  // 不含连续 9\n    res += dfs(pos - 1, limit && d == up, d);\n  }\n  return dp[pos][limit][last] = res;\n}\nint solve(long long n) {\n  int len = 0;\n  while (n) { dig[len++] = n % 10; n /= 10; }\n  memset(dp, -1, sizeof(dp));\n  return dfs(len - 1, true, 0);\n}',
        comment: "limit 标记是否贴上界；last 记录上一位；逐位枚举",
      },
    ],
  },
  {
    id: "counting-dp",
    category: "dp",
    name: "计数DP",
    title: "卡特兰数 + 组合计数",
    summary: "统计方案数。经典：卡特兰数（括号/出栈序列/二叉树形态）、组合数。",
    keywords: ["计数DP", "卡特兰数", "Catalan", "组合数", "方案数", "动态规划", "DP"],
    snippets: [
      {
        code: '// 卡特兰数：h[0]=1, h[n] = sum(h[i]*h[n-1-i])\n// 应用：n 对括号合法方案数、n 个节点二叉树形态数\nlong long h[N];\nh[0] = 1;\nfor (int i = 1; i <= n; i++) {\n  h[i] = 0;\n  for (int j = 0; j < i; j++)\n    h[i] += h[j] * h[i - 1 - j];\n}\n// h[n] 即答案；也等于 C(2n, n) / (n+1)',
        comment: "递推式 h[i] = Σ h[j]·h[i-1-j]；闭式 C(2n,n)/(n+1)",
      },
      {
        code: '// 组合数递推（杨辉三角）：C(n,k) = C(n-1,k-1) + C(n-1,k)\nlong long C[N][N];\nfor (int i = 0; i < N; i++) {\n  C[i][0] = C[i][i] = 1;\n  for (int j = 1; j < i; j++)\n    C[i][j] = C[i-1][j-1] + C[i-1][j];\n}',
        comment: "C[i][j] = i 中选 j 的方案数；递推避免乘除溢出",
      },
    ],
  },

  // ============== 图论 (graph) ==============
  {
    id: "graph-storage-traversal",
    category: "graph",
    name: "图与树的存储遍历",
    title: "邻接表 + DFS/BFS + 二叉树",
    summary: "邻接表用 vector 存储；DFS 递归遍历、BFS 队列层序遍历。二叉树前中后序同理。",
    keywords: ["邻接表", "DFS", "BFS", "遍历", "二叉树", "前序", "中序", "后序", "层序", "存储"],
    snippets: [
      {
        code: '// 邻接表存储\nvector<int> adj[N];\nvoid addEdge(int u, int v) {\n  adj[u].push_back(v);\n  adj[v].push_back(u);  // 无向图\n}\n\nbool vis[N];\nvoid dfs(int u) {\n  vis[u] = true;\n  for (int v : adj[u])\n    if (!vis[v]) dfs(v);\n}',
        comment: "vector 邻接表；DFS 递归遍历",
      },
      {
        code: '// BFS 层序遍历（无权图最短路）\nint dist[N];\nvoid bfs(int s) {\n  memset(dist, -1, sizeof(dist));\n  queue<int> q;\n  q.push(s);\n  dist[s] = 0;\n  while (!q.empty()) {\n    int u = q.front(); q.pop();\n    for (int v : adj[u])\n      if (dist[v] == -1) { dist[v] = dist[u] + 1; q.push(v); }\n  }\n}',
        comment: "dist == -1 表示未访问；BFS 天然求无权图最短路",
      },
      {
        code: '// 二叉树遍历\nstruct Node { int val; Node *l, *r; };\nvoid preOrder(Node* p) {        // 前序：根左右\n  if (!p) return;\n  cout << p->val;\n  preOrder(p->l); preOrder(p->r);\n}\nvoid inOrder(Node* p) {         // 中序：左根右\n  if (!p) return;\n  inOrder(p->l);\n  cout << p->val;\n  inOrder(p->r);\n}\nvoid postOrder(Node* p) {       // 后序：左右根\n  if (!p) return;\n  postOrder(p->l); postOrder(p->r);\n  cout << p->val;\n}',
        comment: "前序=先根；中序=中间访问根；后序=最后访问根",
      },
    ],
  },
  {
    id: "tree-diameter",
    category: "graph",
    name: "树的直径",
    title: "两次 DFS / 树形 DP",
    summary: "树上最长路径。两次 DFS：任选起点找最远点 u，再从 u 找最远点 v，u-v 即直径。",
    keywords: ["树的直径", "最长路径", "两次DFS", "树形DP", "直径", "树"],
    snippets: [
      {
        code: '// 两次 DFS 求树的直径（边权非负）\nint dist[N], farNode;\nvoid dfs(int u, int fa, int d) {\n  dist[u] = d;\n  if (d > dist[farNode]) farNode = u;\n  for (auto [v, w] : adj[u])\n    if (v != fa) dfs(v, u, d + w);\n}\nint diameter(int root) {\n  farNode = root;\n  dfs(root, -1, 0);\n  int u = farNode;\n  dfs(u, -1, 0);\n  return dist[farNode];  // u 到 farNode 的距离\n}',
        comment: "从任意点出发两次 DFS；第一次找最远点 u，第二次从 u 找最远点",
      },
    ],
  },
  {
    id: "tree-center",
    category: "graph",
    name: "树的中心",
    title: "直径中点",
    summary: "树的中心是直径的中点，到所有节点最大距离最小。求出直径后取中点。",
    keywords: ["树的中心", "中心", "直径中点", "最大距离最小", "树"],
    snippets: [
      {
        code: '// 树的中心：直径路径的中点\n// 先求直径路径 path，中心为 path[path.size()/2]\n// （需在 tree-diameter 基础上记录路径）\n// 中心可能有 1 或 2 个（直径边数为奇/偶）\n\n// 朴素思路：枚举每个点 BFS 求最大距离，取最小\nint maxDist(int root, int n) {\n  vector<int> dist(n + 1, -1);\n  queue<int> q; q.push(root);\n  dist[root] = 0;\n  int mx = 0;\n  while (!q.empty()) {\n    int u = q.front(); q.pop();\n    for (int v : adj[u])\n      if (dist[v] == -1) { dist[v] = dist[u] + 1; mx = max(mx, dist[v]); q.push(v); }\n  }\n  return mx;\n}\n// 中心：argmin maxDist(i)',
        comment: "直径边数为偶数时 1 个中心，奇数时 2 个",
      },
    ],
  },
  {
    id: "tree-centroid",
    category: "graph",
    name: "树的重心",
    title: "最大子树最小的节点",
    summary: "删除后使剩余各子树节点数最大值最小的节点。重心可能有 1 或 2 个。",
    keywords: ["树的重心", "重心", "子树节点数", "平衡点", "树"],
    snippets: [
      {
        code: '// 树的重心：删去后最大子树最小的节点\nint sz[N], weight[N], centroid, minW;\nvoid dfs(int u, int fa, int n) {\n  sz[u] = 1; weight[u] = 0;\n  for (int v : adj[u])\n    if (v != fa) {\n      dfs(v, u, n);\n      sz[u] += sz[v];\n      weight[u] = max(weight[u], sz[v]);\n    }\n  weight[u] = max(weight[u], n - sz[u]);  // 父方向子树\n  if (weight[u] < minW) { minW = weight[u]; centroid = u; }\n}\nint findCentroid(int root, int n) {\n  minW = INT_MAX;\n  dfs(root, -1, n);\n  return centroid;\n}',
        comment: "weight[u] = max(最大子树, n-sz[u])；取最小者",
      },
    ],
  },
  {
    id: "lca",
    category: "graph",
    name: "最近公共祖先 LCA",
    title: "倍增法",
    summary: "求两节点在树上的最近公共祖先。倍增预处理 O(n log n)，单次查询 O(log n)。",
    keywords: ["LCA", "最近公共祖先", "倍增", "二进制跳跃", "祖先", "树"],
    snippets: [
      {
        code: '// 倍增 LCA\nint fa[N][21], dep[N];\nvoid dfs(int u, int f) {\n  dep[u] = dep[f] + 1;\n  fa[u][0] = f;\n  for (int k = 1; k <= 20; k++)\n    fa[u][k] = fa[fa[u][k-1]][k-1];\n  for (int v : adj[u])\n    if (v != f) dfs(v, u);\n}\nint lca(int u, int v) {\n  if (dep[u] < dep[v]) swap(u, v);\n  for (int k = 20; k >= 0; k--)\n    if (dep[fa[u][k]] >= dep[v]) u = fa[u][k];  // 跳到同层\n  if (u == v) return u;\n  for (int k = 20; k >= 0; k--)\n    if (fa[u][k] != fa[v][k]) { u = fa[u][k]; v = fa[v][k]; }\n  return fa[u][0];\n}',
        comment: "先跳到同层，再同时向上跳到 LCA 下一层",
      },
    ],
  },
  {
    id: "hld",
    category: "graph",
    name: "树链剖分",
    title: "重链剖分 + 路径查询",
    summary: "把树剖成若干条链，配合线段树支持路径修改/查询。O(n log² n)。",
    keywords: ["树链剖分", "重链剖分", "HLD", "路径查询", "路径修改", "线段树", "树"],
    snippets: [
      {
        code: '// 重链剖分（配合线段树支持路径修改/查询）\nint sz[N], dep[N], fa[N], son[N];  // son=重儿子\nint top[N], dfn[N], rnk[N], timer_;  // top=链顶, dfn=dfs序\nvoid dfs1(int u, int f) {\n  sz[u] = 1; dep[u] = dep[f] + 1; fa[u] = f; son[u] = 0;\n  for (int v : adj[u]) if (v != f) {\n    dfs1(v, u);\n    sz[u] += sz[v];\n    if (sz[v] > sz[son[u]]) son[u] = v;\n  }\n}\nvoid dfs2(int u, int t) {\n  top[u] = t; dfn[u] = ++timer_; rnk[timer_] = u;\n  if (son[u]) dfs2(son[u], t);  // 重儿子继承链顶\n  for (int v : adj[u])\n    if (v != fa[u] && v != son[u]) dfs2(v, v);  // 轻儿子新开链\n}\n// 路径 u-v 修改（在线段树上区间更新）\nvoid updatePath(int u, int v, int val) {\n  while (top[u] != top[v]) {\n    if (dep[top[u]] < dep[top[v]]) swap(u, v);\n    segUpdate(dfn[top[u]], dfn[u], val);  // 线段树更新 [dfn[top[u]], dfn[u]]\n    u = fa[top[u]];\n  }\n  if (dep[u] > dep[v]) swap(u, v);\n  segUpdate(dfn[u], dfn[v], val);\n}',
        comment: "dfs1 求 sz/dep/son；dfs2 求 top/dfn；路径操作沿重链跳",
      },
    ],
  },
  {
    id: "shortest-path",
    category: "graph",
    name: "最短路",
    title: "Dijkstra + Floyd + SPFA",
    summary: "Dijkstra 非负权单源 O(n log n)；Floyd 全源 O(n³)；SPFA 处理负权。",
    keywords: ["最短路", "Dijkstra", "迪杰斯特拉", "Floyd", "弗洛伊德", "SPFA", "单源", "全源", "负权"],
    snippets: [
      {
        code: '// Dijkstra：非负权单源最短路 O(n log n)\nstruct E { int v, w; };\nvector<E> adj[N];\nlong long dis[N];\nvoid dijkstra(int s) {\n  memset(dis, 0x3f, sizeof(dis));\n  dis[s] = 0;\n  priority_queue<pair<long long,int>,\n    vector<pair<long long,int>>, greater<>> pq;\n  pq.push({0, s});\n  while (!pq.empty()) {\n    auto [d, u] = pq.top(); pq.pop();\n    if (d > dis[u]) continue;  // 过时数据跳过\n    for (auto [v, w] : adj[u])\n      if (dis[v] > d + w) {\n        dis[v] = d + w;\n        pq.push({dis[v], v});\n      }\n  }\n}',
        comment: "小根堆取最小；d > dis[u] 表示过时跳过",
      },
      {
        code: '// Floyd：全源最短路 O(n³)\nlong long dis[N][N];\nvoid floyd(int n) {\n  for (int k = 1; k <= n; k++)\n    for (int i = 1; i <= n; i++)\n      for (int j = 1; j <= n; j++)\n        if (dis[i][k] + dis[k][j] < dis[i][j])\n          dis[i][j] = dis[i][k] + dis[k][j];\n}\n// 初始化：dis[i][i]=0, dis[i][j]=边权或 INF',
        comment: "k 必须在最外层；可处理负权但不能有负环",
      },
      {
        code: '// SPFA：处理负权（可判负环）\nbool inQ[N];\nvoid spfa(int s) {\n  memset(dis, 0x3f, sizeof(dis));\n  dis[s] = 0;\n  queue<int> q; q.push(s); inQ[s] = true;\n  while (!q.empty()) {\n    int u = q.front(); q.pop(); inQ[u] = false;\n    for (auto [v, w] : adj[u])\n      if (dis[v] > dis[u] + w) {\n        dis[v] = dis[u] + w;\n        if (!inQ[v]) { q.push(v); inQ[v] = true; }\n      }\n  }\n}',
        comment: "可处理负权；最坏 O(nm)，比 Dijkstra 慢",
      },
    ],
  },
  {
    id: "mst",
    category: "graph",
    name: "最小生成树",
    title: "Kruskal + Prim",
    summary: "Kruskal 按边权排序+并查集，O(m log m)；Prim 从起点扩展，堆优化 O(m log n)。",
    keywords: ["最小生成树", "MST", "Kruskal", "克鲁斯卡尔", "Prim", "普里姆", "并查集", "生成树"],
    snippets: [
      {
        code: '// Kruskal：按边权排序 + 并查集\nstruct Edge { int u, v, w; };\nbool operator<(const Edge& a, const Edge& b) { return a.w < b.w; }\nEdge edges[M];\nint fa[N];\nint find(int x) { return fa[x]==x ? x : fa[x]=find(fa[x]); }\nlong long kruskal(int n, int m) {\n  for (int i = 1; i <= n; i++) fa[i] = i;\n  sort(edges, edges + m);\n  long long sum = 0, cnt = 0;\n  for (int i = 0; i < m && cnt < n - 1; i++) {\n    int u = find(edges[i].u), v = find(edges[i].v);\n    if (u != v) { fa[u] = v; sum += edges[i].w; cnt++; }\n  }\n  return cnt == n - 1 ? sum : -1;  // -1 表示不连通\n}',
        comment: "按边权升序选边；并查集判环；选满 n-1 条边即可",
      },
      {
        code: '// Prim：堆优化，从起点扩展 O(m log n)\nstruct E { int v, w; };\nvector<E> adj[N];\nlong long dis[N]; bool vis[N];\nlong long prim(int n) {\n  memset(dis, 0x3f, sizeof(dis));\n  memset(vis, 0, sizeof(vis));\n  dis[1] = 0;\n  priority_queue<pair<long long,int>,\n    vector<pair<long long,int>>, greater<>> pq;\n  pq.push({0, 1});\n  long long sum = 0, cnt = 0;\n  while (!pq.empty() && cnt < n) {\n    auto [d, u] = pq.top(); pq.pop();\n    if (vis[u]) continue;\n    vis[u] = true; sum += d; cnt++;\n    for (auto [v, w] : adj[u])\n      if (!vis[v] && w < dis[v]) { dis[v] = w; pq.push({w, v}); }\n  }\n  return cnt == n ? sum : -1;\n}',
        comment: "dis[u] = u 到生成树的最短距离；每次取最小加入",
      },
    ],
  },
  {
    id: "connectivity",
    category: "graph",
    name: "连通性",
    title: "并查集 + 强连通分量",
    summary: "并查集维护等价类；Tarjan 求强连通分量（有向图）和割点/桥（无向图）。",
    keywords: ["连通性", "并查集", "union-find", "强连通分量", "SCC", "Tarjan", "割点", "桥", "割边"],
    snippets: [
      {
        code: '// 并查集：路径压缩 + 按秩合并\nint fa[N], rk[N];\nvoid init(int n) {\n  for (int i = 1; i <= n; i++) { fa[i] = i; rk[i] = 0; }\n}\nint find(int x) {\n  return fa[x] == x ? x : fa[x] = find(fa[x]);  // 路径压缩\n}\nvoid unite(int x, int y) {\n  x = find(x); y = find(y);\n  if (x == y) return;\n  if (rk[x] < rk[y]) swap(x, y);   // 按秩合并\n  fa[y] = x;\n  if (rk[x] == rk[y]) rk[x]++;\n}\n// 查询：find(x) == find(y)',
        comment: "路径压缩 + 按秩合并，单次操作近似 O(1)",
      },
      {
        code: '// Tarjan 求有向图强连通分量（SCC）\nint dfn[N], low[N], timer_, scc[N], sccCnt;\nstack<int> stk; bool inStk[N];\nvoid tarjan(int u) {\n  dfn[u] = low[u] = ++timer_;\n  stk.push(u); inStk[u] = true;\n  for (int v : adj[u]) {\n    if (!dfn[v]) { tarjan(v); low[u] = min(low[u], low[v]); }\n    else if (inStk[v]) low[u] = min(low[u], dfn[v]);\n  }\n  if (low[u] == dfn[u]) {\n    sccCnt++;\n    while (true) {\n      int v = stk.top(); stk.pop(); inStk[v] = false;\n      scc[v] = sccCnt;\n      if (v == u) break;\n    }\n  }\n}',
        comment: "dfn=时间戳，low=能回溯到的最早祖先；low==dfn 时弹栈成 SCC",
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
  { id: "io", labelKey: "cheatsheet.catIO" },
  { id: "syntax", labelKey: "cheatsheet.catSyntax" },
  { id: "stl", labelKey: "cheatsheet.catSTL" },
  { id: "algorithm", labelKey: "cheatsheet.catCommonAlgorithm" },
  { id: "dp", labelKey: "cheatsheet.catDP" },
  { id: "graph", labelKey: "cheatsheet.catGraph" },
];

/**
 * 速查表搜索纯函数（加权评分排序）。
 *
 * 大小写不敏感子串匹配，搜索字段：name + title + summary + keywords + snippets.code。
 * 空 query 时仅按 category 过滤（保持分组浏览，原 entries 顺序）。
 * 有 query 时按命中字段加权评分降序排列（分数相同时保持原 entries 顺序，稳定排序）。
 *
 * 评分权重：name 精确=100 > name 子串=80 > keywords 精确=60 > keywords 子串=40
 *          > title 子串=30 > summary 子串=20 > snippet.code 子串=5
 */
export function searchCheatsheet(
  entries: CheatEntry[],
  query: string,
  category: CheatCategory | "all",
): CheatEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return entries.filter((e) => category === "all" || e.category === category);
  }
  // 计算每条命中条目的分数，保留原 index 保证稳定排序
  const scored: Array<{ entry: CheatEntry; score: number; idx: number }> = [];
  entries.forEach((e, idx) => {
    if (category !== "all" && e.category !== category) return;
    const score = scoreEntry(e, q);
    if (score > 0) scored.push({ entry: e, score, idx });
  });
  // 分数降序；分数相同时按原 entries 顺序（稳定）
  scored.sort((a, b) => b.score - a.score || a.idx - b.idx);
  return scored.map((s) => s.entry);
}

/**
 * 计算单条 entry 相对 query 的命中分数。
 * 取所有命中字段最高分；未命中返回 0。
 */
function scoreEntry(e: CheatEntry, q: string): number {
  let score = 0;
  const nameLower = e.name.toLowerCase();
  // name 精确匹配
  if (nameLower === q) score = Math.max(score, 100);
  else if (nameLower.includes(q)) score = Math.max(score, 80);
  // keywords 精确 / 子串
  for (const k of e.keywords) {
    const kLower = k.toLowerCase();
    if (kLower === q) score = Math.max(score, 60);
    else if (kLower.includes(q)) score = Math.max(score, 40);
  }
  // title 子串
  if (e.title.toLowerCase().includes(q)) score = Math.max(score, 30);
  // summary 子串
  if (e.summary.toLowerCase().includes(q)) score = Math.max(score, 20);
  // snippet.code 子串（最低，兜底命中）
  for (const s of e.snippets) {
    if (s.code.toLowerCase().includes(q)) {
      score = Math.max(score, 5);
      break;
    }
  }
  return score;
}

/**
 * 高亮搜索关键字：把 text 中匹配 query 的子串用 <mark> 包裹。
 *
 * - 先转义 text 中的 < > & 防 XSS
 * - 空 query 返回转义后的原文本
 * - 大小写不敏感全局匹配，转义 query 正则元字符
 * - 返回可直接用于 dangerouslySetInnerHTML 的 HTML 字符串
 */
export function highlightText(text: string, query: string): string {
  // 1. 转义 HTML 特殊字符
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const q = query.trim();
  if (!q) return escaped;
  // 2. 转义 query 正则元字符
  const escapedQuery = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // 3. 大小写不敏感全局替换，包裹 <mark>
  const re = new RegExp(escapedQuery, "gi");
  return escaped.replace(re, (m) => `<mark class="cheatsheet-hl">${m}</mark>`);
}

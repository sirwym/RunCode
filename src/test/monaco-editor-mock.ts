// 测试环境 monaco-editor mock
// 真实 monaco-editor 包入口会加载所有语言/contrib，jsdom 下无法解析
// 测试中只需 colorize API，用 mock 提供最小实现
export const editor = {
  colorize: async (text: string): Promise<string> => {
    // 简单包装：返回带 span 的 HTML，便于断言
    return `<span class="tok">${text}</span>`;
  },
};

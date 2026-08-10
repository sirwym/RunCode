import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import FlowchartPanel, {
  resolveMermaidTheme,
  formatCfgError,
  clampScale,
  zoomAtPoint,
  calculateCenterTransform,
} from "./FlowchartPanel";
import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "../hooks/useI18n";
import { zh } from "../locales/zh";
import type { CfgResult, AppErrorPayload } from "../types";

// Mock @tauri-apps/api/core
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Mock mermaid 动态导入
const mockRender = vi.fn();
const mockInitialize = vi.fn();
vi.mock("mermaid", () => ({
  default: {
    initialize: mockInitialize,
    render: mockRender,
  },
}));

// 按点分路径取值
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

function resetI18n() {
  useI18n.setState({
    locale: "zh",
    t: (key: string, params?: Record<string, string | number>) => {
      let s = getByPath(zh, key);
      if (typeof s !== "string") return key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          s = (s as string).replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
        }
      }
      return s as string;
    },
    setLocale: vi.fn(),
  });
}

function makeCfgResult(overrides: Partial<CfgResult> = {}): CfgResult {
  return {
    mermaid: "flowchart TD\n  A[Start] --> B[End]",
    nodes: [
      { id: "A", label: "Start", line: 1, kind: "entry" },
      { id: "B", label: "End", line: 5, kind: "exit" },
    ],
    edges: [{ from: "A", to: "B", label: null }],
    warning: null,
    ...overrides,
  };
}

describe("resolveMermaidTheme", () => {
  it("dark → dark", () => {
    expect(resolveMermaidTheme("dark")).toBe("dark");
  });

  it("light → default", () => {
    expect(resolveMermaidTheme("light")).toBe("default");
  });

  it("custom + baseMode dark → dark", () => {
    expect(resolveMermaidTheme("custom", "dark")).toBe("dark");
  });

  it("custom + baseMode light → default", () => {
    expect(resolveMermaidTheme("custom", "light")).toBe("default");
  });

  it("custom 无 baseMode → dark（安全回退）", () => {
    expect(resolveMermaidTheme("custom")).toBe("dark");
  });
});

describe("formatCfgError", () => {
  const t = (key: string, params?: Record<string, string | number>) => {
    let s = getByPath(zh, key);
    if (typeof s !== "string") return key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        s = (s as string).replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
      }
    }
    return s as string;
  };

  it("未找到函数定义 → flowchartNoFunction", () => {
    const err: AppErrorPayload = { code: "other", params: { detail: "未找到函数定义" } };
    expect(formatCfgError(err, t)).toBe(zh.panel.flowchartNoFunction);
  });

  it("其他错误 → flowchartError + detail", () => {
    const err: AppErrorPayload = { code: "other", params: { detail: "解析失败" } };
    const expected = zh.panel.flowchartError.replace("{detail}", "解析失败");
    expect(formatCfgError(err, t)).toBe(expected);
  });

  it("非 AppErrorPayload → flowchartError + String(e)", () => {
    const expected = zh.panel.flowchartError.replace("{detail}", "some error");
    expect(formatCfgError("some error", t)).toBe(expected);
  });
});

describe("主题配置", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetI18n();
    mockRender.mockResolvedValue({ svg: '<svg><g class="node" id="flowchart-A-0"></g></svg>' });
  });

  afterEach(() => {
    cleanup();
  });

  it("dark 主题：initialize 使用 base + darkMode=true", async () => {
    const mockInvoke = invoke as ReturnType<typeof vi.fn>;
    mockInvoke.mockResolvedValue(makeCfgResult());

    render(
      <FlowchartPanel
        code="int main() { return 0; }"
        onNodeClick={() => {}}
        visible={true}
        theme="dark"
      />,
    );

    await waitFor(() => {
      expect(mockInitialize).toHaveBeenCalled();
    });

    const initCall = mockInitialize.mock.calls[0][0];
    expect(initCall.theme).toBe("base");
    expect(initCall.themeVariables.background).toBe("transparent");
    expect(initCall.themeVariables.darkMode).toBe(true);
    expect(initCall.flowchart.useMaxWidth).toBe(false);
    expect(initCall.flowchart.htmlLabels).toBe(true);
  });

  it("light 主题：darkMode=false", async () => {
    const mockInvoke = invoke as ReturnType<typeof vi.fn>;
    mockInvoke.mockResolvedValue(makeCfgResult());

    render(
      <FlowchartPanel
        code="int main() { return 0; }"
        onNodeClick={() => {}}
        visible={true}
        theme="light"
      />,
    );

    await waitFor(() => {
      expect(mockInitialize).toHaveBeenCalled();
    });

    const initCall = mockInitialize.mock.calls[0][0];
    expect(initCall.theme).toBe("base");
    expect(initCall.themeVariables.darkMode).toBe(false);
  });
});

describe("FlowchartPanel 组件", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetI18n();
    mockRender.mockResolvedValue({ svg: '<svg><g class="node" id="flowchart-A-0"></g></svg>' });
  });

  afterEach(() => {
    cleanup();
  });

  it("无代码时显示提示", async () => {
    const mockInvoke = invoke as ReturnType<typeof vi.fn>;
    mockInvoke.mockResolvedValue(makeCfgResult());

    render(
      <FlowchartPanel
        code=""
        onNodeClick={() => {}}
        visible={true}
        theme="dark"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(zh.panel.flowchartNoCode)).toBeInTheDocument();
    });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("可见时自动调用 generate_cfg", async () => {
    const mockInvoke = invoke as ReturnType<typeof vi.fn>;
    mockInvoke.mockResolvedValue(makeCfgResult());

    render(
      <FlowchartPanel
        code="int main() { return 0; }"
        onNodeClick={() => {}}
        visible={true}
        theme="dark"
      />,
    );

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("generate_cfg", {
        code: "int main() { return 0; }",
      });
    });
  });

  it("invoke 失败返回未找到函数定义时显示对应文案", async () => {
    const mockInvoke = invoke as ReturnType<typeof vi.fn>;
    mockInvoke.mockRejectedValue({ code: "other", params: { detail: "未找到函数定义" } });

    render(
      <FlowchartPanel
        code="int x = 0;"
        onNodeClick={() => {}}
        visible={true}
        theme="dark"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(zh.panel.flowchartNoFunction)).toBeInTheDocument();
    });
  });

  it("invoke 失败返回其他错误时显示错误文案", async () => {
    const mockInvoke = invoke as ReturnType<typeof vi.fn>;
    mockInvoke.mockRejectedValue({ code: "other", params: { detail: "解析超时" } });

    render(
      <FlowchartPanel
        code="int x = 0;"
        onNodeClick={() => {}}
        visible={true}
        theme="dark"
      />,
    );

    await waitFor(() => {
      const expected = zh.panel.flowchartError.replace("{detail}", "解析超时");
      expect(screen.getByText(expected)).toBeInTheDocument();
    });
  });

  it("结果含 warning 时显示警告", async () => {
    const mockInvoke = invoke as ReturnType<typeof vi.fn>;
    mockInvoke.mockResolvedValue(makeCfgResult({ warning: "节点过多" }));

    render(
      <FlowchartPanel
        code="int main() { return 0; }"
        onNodeClick={() => {}}
        visible={true}
        theme="dark"
      />,
    );

    await waitFor(() => {
      const expected = zh.panel.flowchartWarning.replace("{detail}", "节点过多");
      expect(screen.getByText(expected)).toBeInTheDocument();
    });
  });

  it("点击刷新按钮重新调用 generate_cfg", async () => {
    const mockInvoke = invoke as ReturnType<typeof vi.fn>;
    mockInvoke.mockResolvedValue(makeCfgResult());

    render(
      <FlowchartPanel
        code="int main() { return 0; }"
        onNodeClick={() => {}}
        visible={true}
        theme="dark"
      />,
    );

    // 等待首次自动生成完成（loading 消失）
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });

    // 等待 loading 状态结束，按钮可用
    await waitFor(() => {
      const btn = screen.getByTitle(zh.panel.flowchartRefresh);
      expect(btn).not.toBeDisabled();
    });

    // 点击刷新
    const refreshBtn = screen.getByTitle(zh.panel.flowchartRefresh);
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledTimes(2);
    });
  });

  it("mermaid render 被调用并渲染 SVG", async () => {
    const mockInvoke = invoke as ReturnType<typeof vi.fn>;
    mockInvoke.mockResolvedValue(makeCfgResult());

    render(
      <FlowchartPanel
        code="int main() { return 0; }"
        onNodeClick={() => {}}
        visible={true}
        theme="dark"
      />,
    );

    // 等待 mermaid render 被调用
    await waitFor(() => {
      expect(mockRender).toHaveBeenCalled();
    });

    // 等待 SVG 被注入到 DOM
    await waitFor(() => {
      const wrapperEl = document.querySelector(".flowchart-svg-wrapper");
      expect(wrapperEl?.innerHTML).toContain("<svg");
    });
  });
});

describe("事件委托", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetI18n();
    mockRender.mockResolvedValue({
      svg: '<svg><g class="node" id="flowchart-A-0"><rect></rect></g></svg>',
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("点击 line>0 的节点触发 onNodeClick", async () => {
    const mockInvoke = invoke as ReturnType<typeof vi.fn>;
    const onNodeClick = vi.fn();
    mockInvoke.mockResolvedValue(makeCfgResult());

    render(
      <FlowchartPanel
        code="int main() { return 0; }"
        onNodeClick={onNodeClick}
        visible={true}
        theme="dark"
      />,
    );

    await waitFor(() => {
      expect(document.querySelector(".node")).toBeTruthy();
    });
    // 等待 useEffect 完成 attachClickHandlers（cursor 被设置为 pointer）
    await waitFor(() => {
      expect((document.querySelector(".node") as HTMLElement).style.cursor).toBe("pointer");
    });

    fireEvent.click(document.querySelector(".node") as HTMLElement);

    expect(onNodeClick).toHaveBeenCalledWith(1);
  });

  it("line=0 的节点不触发 onNodeClick", async () => {
    const mockInvoke = invoke as ReturnType<typeof vi.fn>;
    const onNodeClick = vi.fn();
    mockInvoke.mockResolvedValue(
      makeCfgResult({
        nodes: [
          { id: "A", label: "Start", line: 0, kind: "entry" },
          { id: "B", label: "End", line: 5, kind: "exit" },
        ],
      }),
    );

    render(
      <FlowchartPanel
        code="int main() { return 0; }"
        onNodeClick={onNodeClick}
        visible={true}
        theme="dark"
      />,
    );

    await waitFor(() => {
      expect(document.querySelector(".node")).toBeTruthy();
    });
    // 等待 useEffect 执行完毕
    await new Promise((r) => setTimeout(r, 50));

    fireEvent.click(document.querySelector(".node") as HTMLElement);

    expect(onNodeClick).not.toHaveBeenCalled();
  });

  it("点击 SVG 内非节点区域不触发 onNodeClick", async () => {
    const mockInvoke = invoke as ReturnType<typeof vi.fn>;
    const onNodeClick = vi.fn();
    mockInvoke.mockResolvedValue(makeCfgResult());
    mockRender.mockResolvedValue({
      svg: '<svg><g class="node" id="flowchart-A-0"><rect></rect></g><text x="10" y="10">label</text></svg>',
    });

    render(
      <FlowchartPanel
        code="int main() { return 0; }"
        onNodeClick={onNodeClick}
        visible={true}
        theme="dark"
      />,
    );

    await waitFor(() => {
      expect(document.querySelector("text")).toBeTruthy();
    });
    await new Promise((r) => setTimeout(r, 50));

    fireEvent.click(document.querySelector("text") as Element);

    expect(onNodeClick).not.toHaveBeenCalled();
  });
});

describe("缩放纯函数", () => {
  describe("clampScale", () => {
    it("低于下限返回 0.25", () => {
      expect(clampScale(0.1)).toBe(0.25);
    });

    it("高于上限返回 3", () => {
      expect(clampScale(5)).toBe(3);
    });

    it("范围内返回原值", () => {
      expect(clampScale(1)).toBe(1);
      expect(clampScale(0.5)).toBe(0.5);
      expect(clampScale(2)).toBe(2);
    });
  });

  describe("zoomAtPoint", () => {
    it("以鼠标位置为中心放大 2 倍", () => {
      const current = { x: 0, y: 0, scale: 1 };
      const result = zoomAtPoint(current, 100, 50, 2);
      expect(result).toEqual({ x: -100, y: -50, scale: 2 });
    });

    it("以鼠标位置为中心缩小到 0.5 倍", () => {
      const current = { x: 0, y: 0, scale: 1 };
      const result = zoomAtPoint(current, 100, 50, 0.5);
      expect(result).toEqual({ x: 50, y: 25, scale: 0.5 });
    });

    it("非零起点 transform 正确缩放", () => {
      const current = { x: 200, y: 100, scale: 2 };
      const result = zoomAtPoint(current, 300, 200, 1);
      expect(result).toEqual({ x: 250, y: 150, scale: 1 });
    });

    it("缩放超过上限时 clamp 到 3", () => {
      const current = { x: 0, y: 0, scale: 1 };
      const result = zoomAtPoint(current, 0, 0, 10);
      expect(result.scale).toBe(3);
    });

    it("缩放低于下限时 clamp 到 0.25", () => {
      const current = { x: 0, y: 0, scale: 1 };
      const result = zoomAtPoint(current, 0, 0, 0.01);
      expect(result.scale).toBe(0.25);
    });
  });

  describe("calculateCenterTransform", () => {
    it("容器大于内容时居中（正偏移）", () => {
      const result = calculateCenterTransform(800, 600, 400, 300);
      expect(result).toEqual({ x: 200, y: 150, scale: 1 });
    });

    it("容器小于内容时居中（负偏移）", () => {
      const result = calculateCenterTransform(400, 300, 800, 600);
      expect(result).toEqual({ x: -200, y: -150, scale: 1 });
    });

    it("容器等于内容时偏移为零", () => {
      const result = calculateCenterTransform(400, 300, 400, 300);
      expect(result).toEqual({ x: 0, y: 0, scale: 1 });
    });

    it("零尺寸容器返回零偏移", () => {
      const result = calculateCenterTransform(0, 0, 0, 0);
      expect(result).toEqual({ x: 0, y: 0, scale: 1 });
    });
  });
});

describe("缩放与拖拽交互", () => {
  let originalRAF: typeof globalThis.requestAnimationFrame;
  let originalGBCR: typeof Element.prototype.getBoundingClientRect;

  beforeEach(() => {
    vi.clearAllMocks();
    resetI18n();
    mockRender.mockResolvedValue({
      svg: '<svg width="400" height="300"><g class="node" id="flowchart-A-0"><rect></rect></g></svg>',
    });

    originalRAF = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    }) as typeof globalThis.requestAnimationFrame;

    originalGBCR = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = vi.fn(() => ({
      width: 800,
      height: 600,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => {},
    })) as typeof Element.prototype.getBoundingClientRect;
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRAF;
    Element.prototype.getBoundingClientRect = originalGBCR;
    cleanup();
  });

  async function renderAndWait() {
    const mockInvoke = invoke as ReturnType<typeof vi.fn>;
    mockInvoke.mockResolvedValue(makeCfgResult());
    render(
      <FlowchartPanel
        code="int main() { return 0; }"
        onNodeClick={() => {}}
        visible={true}
        theme="dark"
      />,
    );
    await waitFor(() => {
      expect(document.querySelector(".flowchart-svg-wrapper")).toBeTruthy();
    });
  }

  it("工具栏有放大、缩小、重置缩放按钮", async () => {
    await renderAndWait();
    expect(screen.getByTitle(zh.panel.flowchartZoomIn)).toBeInTheDocument();
    expect(screen.getByTitle(zh.panel.flowchartZoomOut)).toBeInTheDocument();
    expect(screen.getByTitle(zh.panel.flowchartZoomReset)).toBeInTheDocument();
  });

  it("点击放大按钮后 scale 增加", async () => {
    await renderAndWait();
    const wrapper = document.querySelector(".flowchart-svg-wrapper") as HTMLElement;
    expect(wrapper.style.transform).toContain("scale(1)");

    fireEvent.click(screen.getByTitle(zh.panel.flowchartZoomIn));

    expect(wrapper.style.transform).toContain("scale(1.25)");
    expect(wrapper.style.transform).toContain("translate(-100px, -75px)");
  });

  it("点击缩小按钮后 scale 减小", async () => {
    await renderAndWait();
    const wrapper = document.querySelector(".flowchart-svg-wrapper") as HTMLElement;

    fireEvent.click(screen.getByTitle(zh.panel.flowchartZoomOut));

    expect(wrapper.style.transform).toContain("scale(0.8)");
    expect(wrapper.style.transform).toContain("translate(80px, 60px)");
  });

  it("点击重置按钮后 transform 恢复 scale(1)", async () => {
    await renderAndWait();
    const wrapper = document.querySelector(".flowchart-svg-wrapper") as HTMLElement;

    fireEvent.click(screen.getByTitle(zh.panel.flowchartZoomIn));
    expect(wrapper.style.transform).toContain("scale(1.25)");

    fireEvent.click(screen.getByTitle(zh.panel.flowchartZoomReset));
    expect(wrapper.style.transform).toContain("scale(1)");
    expect(wrapper.style.transform).toContain("translate(0px, 0px)");
  });

  it("滚轮向上滚动放大", async () => {
    await renderAndWait();
    const content = document.querySelector(".flowchart-content") as HTMLElement;
    const wrapper = document.querySelector(".flowchart-svg-wrapper") as HTMLElement;

    fireEvent.wheel(content, { deltaY: -100, clientX: 400, clientY: 300 });

    expect(wrapper.style.transform).toContain("scale(1.25)");
  });

  it("滚轮向下滚动缩小", async () => {
    await renderAndWait();
    const content = document.querySelector(".flowchart-content") as HTMLElement;
    const wrapper = document.querySelector(".flowchart-svg-wrapper") as HTMLElement;

    fireEvent.wheel(content, { deltaY: 100, clientX: 400, clientY: 300 });

    expect(wrapper.style.transform).toContain("scale(0.8)");
  });

  it("拖拽平移后 transform 变化", async () => {
    await renderAndWait();
    const content = document.querySelector(".flowchart-content") as HTMLElement;
    const wrapper = document.querySelector(".flowchart-svg-wrapper") as HTMLElement;

    fireEvent.mouseDown(content, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.mouseMove(window, { clientX: 150, clientY: 120 });
    fireEvent.mouseUp(window);

    expect(wrapper.style.transform).toContain("translate(50px, 20px)");
  });

  it("拖拽后点击节点不触发 onNodeClick", async () => {
    const onNodeClick = vi.fn();
    const mockInvoke = invoke as ReturnType<typeof vi.fn>;
    mockInvoke.mockResolvedValue(makeCfgResult());
    render(
      <FlowchartPanel
        code="int main() { return 0; }"
        onNodeClick={onNodeClick}
        visible={true}
        theme="dark"
      />,
    );

    await waitFor(() => {
      expect((document.querySelector(".node") as HTMLElement).style.cursor).toBe("pointer");
    });

    const content = document.querySelector(".flowchart-content") as HTMLElement;
    const node = document.querySelector(".node") as HTMLElement;

    fireEvent.mouseDown(content, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.mouseMove(window, { clientX: 150, clientY: 100 });
    fireEvent.mouseUp(window);

    fireEvent.click(node);

    expect(onNodeClick).not.toHaveBeenCalled();
  });

  it("非拖拽点击仍触发 onNodeClick", async () => {
    const onNodeClick = vi.fn();
    const mockInvoke = invoke as ReturnType<typeof vi.fn>;
    mockInvoke.mockResolvedValue(makeCfgResult());
    render(
      <FlowchartPanel
        code="int main() { return 0; }"
        onNodeClick={onNodeClick}
        visible={true}
        theme="dark"
      />,
    );

    await waitFor(() => {
      expect((document.querySelector(".node") as HTMLElement).style.cursor).toBe("pointer");
    });

    const content = document.querySelector(".flowchart-content") as HTMLElement;
    const node = document.querySelector(".node") as HTMLElement;

    fireEvent.mouseDown(content, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.mouseMove(window, { clientX: 103, clientY: 100 });
    fireEvent.mouseUp(window);

    fireEvent.click(node);

    expect(onNodeClick).toHaveBeenCalledWith(1);
  });

  it("连续放大到上限后放大按钮禁用", async () => {
    await renderAndWait();
    const zoomInBtn = screen.getByTitle(zh.panel.flowchartZoomIn);

    for (let i = 0; i < 10; i++) {
      if (zoomInBtn.hasAttribute("disabled")) break;
      fireEvent.click(zoomInBtn);
    }

    expect(zoomInBtn).toBeDisabled();
  });

  it("拖拽后点击被抑制，再单独点击节点仍正常触发", async () => {
    const onNodeClick = vi.fn();
    const mockInvoke = invoke as ReturnType<typeof vi.fn>;
    mockInvoke.mockResolvedValue(makeCfgResult());
    render(
      <FlowchartPanel
        code="int main() { return 0; }"
        onNodeClick={onNodeClick}
        visible={true}
        theme="dark"
      />,
    );

    await waitFor(() => {
      expect((document.querySelector(".node") as HTMLElement).style.cursor).toBe("pointer");
    });

    const content = document.querySelector(".flowchart-content") as HTMLElement;
    const node = document.querySelector(".node") as HTMLElement;

    // 第一次：拖拽后点击 → 应被抑制
    fireEvent.mouseDown(content, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.mouseMove(window, { clientX: 150, clientY: 100 });
    fireEvent.mouseUp(window);
    fireEvent.click(node);
    expect(onNodeClick).not.toHaveBeenCalled();

    // 第二次：纯点击（无拖拽）→ 应正常触发
    fireEvent.mouseDown(content, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.mouseMove(window, { clientX: 102, clientY: 100 });
    fireEvent.mouseUp(window);
    fireEvent.click(node);
    expect(onNodeClick).toHaveBeenCalledWith(1);
  });

  it("快速连续点击不残留拖拽状态", async () => {
    const onNodeClick = vi.fn();
    const mockInvoke = invoke as ReturnType<typeof vi.fn>;
    mockInvoke.mockResolvedValue(makeCfgResult());
    render(
      <FlowchartPanel
        code="int main() { return 0; }"
        onNodeClick={onNodeClick}
        visible={true}
        theme="dark"
      />,
    );

    await waitFor(() => {
      expect((document.querySelector(".node") as HTMLElement).style.cursor).toBe("pointer");
    });

    const content = document.querySelector(".flowchart-content") as HTMLElement;
    const node = document.querySelector(".node") as HTMLElement;

    // 连续 3 次快速点击（每次 mousedown → mouseup → click，无拖拽）
    for (let i = 0; i < 3; i++) {
      fireEvent.mouseDown(content, { clientX: 100, clientY: 100, button: 0 });
      fireEvent.mouseUp(window);
      fireEvent.click(node);
    }

    expect(onNodeClick).toHaveBeenCalledTimes(3);
  });

  it("右键释放不中断左键拖拽", async () => {
    await renderAndWait();
    const content = document.querySelector(".flowchart-content") as HTMLElement;
    const wrapper = document.querySelector(".flowchart-svg-wrapper") as HTMLElement;

    // 左键开始拖拽
    fireEvent.mouseDown(content, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.mouseMove(window, { clientX: 150, clientY: 100 });

    // 右键释放（不应中断拖拽）
    fireEvent.mouseUp(window, { button: 2 });

    // 继续移动 — 拖拽应仍在进行
    fireEvent.mouseMove(window, { clientX: 200, clientY: 100 });

    // 左键释放
    fireEvent.mouseUp(window, { button: 0 });

    // 总位移应为 100px（100 → 200），若右键释放中断了拖拽则只有 50px
    expect(wrapper.style.transform).toContain("translate(100px, 0px)");
  });

  it("多次拖拽-点击循环后行为仍正确", async () => {
    const onNodeClick = vi.fn();
    const mockInvoke = invoke as ReturnType<typeof vi.fn>;
    mockInvoke.mockResolvedValue(makeCfgResult());
    render(
      <FlowchartPanel
        code="int main() { return 0; }"
        onNodeClick={onNodeClick}
        visible={true}
        theme="dark"
      />,
    );

    await waitFor(() => {
      expect((document.querySelector(".node") as HTMLElement).style.cursor).toBe("pointer");
    });

    const content = document.querySelector(".flowchart-content") as HTMLElement;
    const node = document.querySelector(".node") as HTMLElement;

    // 3 次拖拽-点击循环，每次拖拽后点击应被抑制
    for (let i = 0; i < 3; i++) {
      fireEvent.mouseDown(content, { clientX: 100, clientY: 100, button: 0 });
      fireEvent.mouseMove(window, { clientX: 150, clientY: 100 });
      fireEvent.mouseUp(window);
      fireEvent.click(node);
    }
    expect(onNodeClick).not.toHaveBeenCalled();

    // 之后纯点击仍应正常触发
    fireEvent.mouseDown(content, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.mouseUp(window);
    fireEvent.click(node);
    expect(onNodeClick).toHaveBeenCalledWith(1);
  });

  it("从节点上开始拖拽也抑制点击", async () => {
    const onNodeClick = vi.fn();
    const mockInvoke = invoke as ReturnType<typeof vi.fn>;
    mockInvoke.mockResolvedValue(makeCfgResult());
    render(
      <FlowchartPanel
        code="int main() { return 0; }"
        onNodeClick={onNodeClick}
        visible={true}
        theme="dark"
      />,
    );

    await waitFor(() => {
      expect((document.querySelector(".node") as HTMLElement).style.cursor).toBe("pointer");
    });

    const node = document.querySelector(".node") as HTMLElement;

    // 从节点上 mousedown 并拖拽（事件冒泡到 content）
    fireEvent.mouseDown(node, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.mouseMove(window, { clientX: 150, clientY: 100 });
    fireEvent.mouseUp(window);
    fireEvent.click(node);
    expect(onNodeClick).not.toHaveBeenCalled();

    // 之后纯点击节点仍正常
    fireEvent.mouseDown(node, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.mouseUp(window);
    fireEvent.click(node);
    expect(onNodeClick).toHaveBeenCalledWith(1);
  });

  it("缩放后拖拽仍正确抑制点击", async () => {
    const onNodeClick = vi.fn();
    const mockInvoke = invoke as ReturnType<typeof vi.fn>;
    mockInvoke.mockResolvedValue(makeCfgResult());
    render(
      <FlowchartPanel
        code="int main() { return 0; }"
        onNodeClick={onNodeClick}
        visible={true}
        theme="dark"
      />,
    );

    await waitFor(() => {
      expect((document.querySelector(".node") as HTMLElement).style.cursor).toBe("pointer");
    });

    // 先放大
    fireEvent.click(screen.getByTitle(zh.panel.flowchartZoomIn));

    const content = document.querySelector(".flowchart-content") as HTMLElement;
    const node = document.querySelector(".node") as HTMLElement;

    // 拖拽后点击应被抑制
    fireEvent.mouseDown(content, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.mouseMove(window, { clientX: 150, clientY: 100 });
    fireEvent.mouseUp(window);
    fireEvent.click(node);
    expect(onNodeClick).not.toHaveBeenCalled();

    // 之后纯点击仍正常
    fireEvent.mouseDown(content, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.mouseUp(window);
    fireEvent.click(node);
    expect(onNodeClick).toHaveBeenCalledWith(1);
  });
});

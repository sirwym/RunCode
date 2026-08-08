import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RefreshCw, Loader2, ZoomIn, ZoomOut, Maximize } from "lucide-react";
import { useI18n } from "../hooks/useI18n";
import type { CfgResult, AppErrorPayload } from "../types";

interface FlowchartPanelProps {
  code: string;
  onNodeClick: (line: number) => void;
  visible: boolean;
  theme: "dark" | "light" | "custom";
  baseMode?: "light" | "dark";
}

// Mermaid 模块缓存（懒加载，避免首屏加载 mermaid ~500KB）
let mermaidModule: typeof import("mermaid") | null = null;
let initializedTheme: string | null = null;

// 读取 CSS 变量值
function readCssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

async function getMermaid(themeKey: string) {
  if (!mermaidModule) {
    mermaidModule = await import("mermaid");
  }
  const m = mermaidModule.default;
  if (initializedTheme !== themeKey) {
    const isDark = themeKey === "dark";
    // --panel-bg-alt 在 custom 主题下是 rgba，fallback 到 --bg（所有主题均 hex）
    const panelBgAlt = readCssVar("--panel-bg-alt");
    m.initialize({
      startOnLoad: false,
      securityLevel: "loose",
      theme: "base",
      themeVariables: {
        primaryColor: panelBgAlt.startsWith("#") ? panelBgAlt : readCssVar("--bg"),
        primaryTextColor: readCssVar("--text"),
        primaryBorderColor: readCssVar("--border"),
        lineColor: readCssVar("--text-muted"),
        textColor: readCssVar("--text-muted"),
        background: "transparent",
        fontFamily: readCssVar("--font-mono"),
        darkMode: isDark,
      },
      flowchart: { useMaxWidth: false, htmlLabels: true, curve: "basis" },
    });
    initializedTheme = themeKey;
  }
  return m;
}

// 将 effectiveTheme 解析为 mermaid 主题名
export function resolveMermaidTheme(
  theme: "dark" | "light" | "custom",
  baseMode?: "light" | "dark",
): string {
  if (theme === "light") return "default";
  if (theme === "custom") return baseMode === "light" ? "default" : "dark";
  return "dark";
}

// 解析 invoke 错误为可读文本
export function formatCfgError(
  e: unknown,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  const err = e as AppErrorPayload;
  if (err && typeof err === "object" && typeof err.code === "string") {
    const detail = err.params?.detail ?? "";
    if (detail.includes("未找到函数定义")) {
      return t("panel.flowchartNoFunction");
    }
    return t("panel.flowchartError", { detail });
  }
  return t("panel.flowchartError", { detail: String(e) });
}

// ============== 缩放与拖拽 ==============
const MIN_SCALE = 0.25;
const MAX_SCALE = 3;
const ZOOM_STEP = 1.25;
const DRAG_THRESHOLD = 5;

interface Transform {
  x: number;
  y: number;
  scale: number;
}

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function zoomAtPoint(
  current: Transform,
  mouseX: number,
  mouseY: number,
  newScale: number,
): Transform {
  const clampedScale = clampScale(newScale);
  const contentX = (mouseX - current.x) / current.scale;
  const contentY = (mouseY - current.y) / current.scale;
  return {
    x: mouseX - contentX * clampedScale,
    y: mouseY - contentY * clampedScale,
    scale: clampedScale,
  };
}

export function calculateCenterTransform(
  containerWidth: number,
  containerHeight: number,
  contentWidth: number,
  contentHeight: number,
): Transform {
  return {
    x: (containerWidth - contentWidth) / 2,
    y: (containerHeight - contentHeight) / 2,
    scale: 1,
  };
}

// 为 SVG 中的 mermaid 节点附加点击跳转（事件委托 + 返回清理函数）
function attachClickHandlers(
  container: HTMLElement,
  nodes: CfgResult["nodes"],
  onNodeClick: (line: number) => void,
  wasDragging?: () => boolean,
): () => void {
  // 只映射 line > 0 的节点（line=0 的空 merge/after 节点不可点击）
  const lineMap = new Map<string, number>();
  for (const n of nodes) {
    if (n.line > 0) lineMap.set(n.id, n.line);
  }

  const handleClick = (e: MouseEvent) => {
    if (wasDragging?.()) return;
    const target = e.target as HTMLElement;
    const nodeEl = target.closest<HTMLElement>(".node");
    if (!nodeEl) return;
    const match = nodeEl.id.match(/^flowchart-(.+?)-\d+$/);
    const nodeId = match ? match[1] : nodeEl.id;
    const line = lineMap.get(nodeId);
    if (line !== undefined) {
      onNodeClick(line);
    }
  };

  container.addEventListener("click", handleClick);

  // 设置可点击节点的 cursor
  const nodeEls = container.querySelectorAll<HTMLElement>(".node");
  for (const el of nodeEls) {
    const match = el.id.match(/^flowchart-(.+?)-\d+$/);
    const nodeId = match ? match[1] : el.id;
    if (lineMap.has(nodeId)) {
      el.style.cursor = "pointer";
    }
  }

  return () => container.removeEventListener("click", handleClick);
}

export default function FlowchartPanel({
  code,
  onNodeClick,
  visible,
  theme,
  baseMode,
}: FlowchartPanelProps) {
  const t = useI18n((s) => s.t);
  const svgContainerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const renderIdRef = useRef(0);
  const lastCfgRef = useRef<CfgResult | null>(null);
  // 持有最新 onNodeClick，避免内联箭头函数引用变化导致 useEffect 频繁触发
  const onNodeClickRef = useRef(onNodeClick);
  onNodeClickRef.current = onNodeClick;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [hasResult, setHasResult] = useState(false);
  const [svgContent, setSvgContent] = useState<string>("");
  const mermaidTheme = resolveMermaidTheme(theme, baseMode);

  // transform 状态
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1 });
  const transformRef = useRef(transform);
  transformRef.current = transform;

  // 拖拽状态
  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    hasDragged: boolean;
  } | null>(null);

  // 记录最近一次拖拽是否发生过（mouseup 后供 click 处理器检查）
  const wasDraggedRef = useRef(false);

  // 标记是否需要重置 transform（新生成流程图时为 true）
  const resetTransformRef = useRef(false);
  const hasSvg = !loading && !error && !!svgContent;

  // SVG 内容变化后设置 innerHTML + 附加点击处理器 + 处理初始居中
  // 使用 ref 设置 innerHTML 而非 dangerouslySetInnerHTML，避免 transform 变化时 React 重建 SVG DOM
  useEffect(() => {
    if (!svgContent || !svgContainerRef.current || !lastCfgRef.current) return;

    svgContainerRef.current.innerHTML = svgContent;

    const cleanup = attachClickHandlers(
      svgContainerRef.current,
      lastCfgRef.current.nodes,
      (line) => onNodeClickRef.current(line),
      () => {
        const v = wasDraggedRef.current;
        wasDraggedRef.current = false;
        return v;
      },
    );

    // 新生成流程图时重置 transform 并居中（主题切换时不重置）
    if (resetTransformRef.current) {
      resetTransformRef.current = false;
      const contentEl = contentRef.current;
      const wrapperEl = svgContainerRef.current;
      if (contentEl && wrapperEl) {
        requestAnimationFrame(() => {
          const svgEl = wrapperEl.querySelector("svg");
          setTransform(calculateCenterTransform(
            contentEl.clientWidth,
            contentEl.clientHeight,
            svgEl?.clientWidth ?? 0,
            svgEl?.clientHeight ?? 0,
          ));
        });
      }
    }

    return cleanup;
  }, [svgContent]);

  // 滚轮缩放
  useEffect(() => {
    const contentEl = contentRef.current;
    if (!contentEl) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = contentEl.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      setTransform((prev) => zoomAtPoint(prev, mouseX, mouseY, prev.scale * factor));
    };

    contentEl.addEventListener("wheel", handleWheel, { passive: false });
    return () => contentEl.removeEventListener("wheel", handleWheel);
  }, []);

  // 拖拽 mousedown
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    wasDraggedRef.current = false;
    dragStateRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: transformRef.current.x,
      originY: transformRef.current.y,
      hasDragged: false,
    };
  }, []);

  // 拖拽 mousemove + mouseup（在 window 上监听）
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (!drag.hasDragged && Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) {
        drag.hasDragged = true;
        wasDraggedRef.current = true;
        contentRef.current?.classList.add("dragging");
      }
      if (drag.hasDragged) {
        setTransform((prev) => ({
          ...prev,
          x: drag.originX + dx,
          y: drag.originY + dy,
        }));
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (dragStateRef.current?.hasDragged) {
        contentRef.current?.classList.remove("dragging");
      }
      // 清除 dragStateRef：停止 mousemove 处理
      // wasDraggedRef 保留 true，供后续 click 事件检查
      dragStateRef.current = null;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  // 工具栏按钮缩放（以容器中心为缩放点）
  const zoomByButton = useCallback((factor: number) => {
    const contentEl = contentRef.current;
    if (!contentEl) return;
    const rect = contentEl.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    setTransform((prev) => zoomAtPoint(prev, centerX, centerY, prev.scale * factor));
  }, []);

  const handleZoomReset = useCallback(() => {
    const contentEl = contentRef.current;
    const wrapperEl = svgContainerRef.current;
    if (!contentEl || !wrapperEl) {
      setTransform({ x: 0, y: 0, scale: 1 });
      return;
    }
    const svgEl = wrapperEl.querySelector("svg");
    setTransform(calculateCenterTransform(
      contentEl.clientWidth,
      contentEl.clientHeight,
      svgEl?.clientWidth ?? 0,
      svgEl?.clientHeight ?? 0,
    ));
  }, []);

  const renderMermaid = useCallback(
    async (renderId: number, cfg: CfgResult) => {
      if (!cfg.mermaid) return;
      try {
        const m = await getMermaid(mermaidTheme);
        if (renderId !== renderIdRef.current) return;
        const { svg } = await m.render(`cfg-svg-${renderId}`, cfg.mermaid);
        if (renderId !== renderIdRef.current) return;
        setSvgContent(svg);
      } catch (e) {
        if (renderId === renderIdRef.current) {
          setError(t("panel.flowchartError", { detail: String(e) }));
        }
      }
    },
    [mermaidTheme, t],
  );

  const generate = useCallback(async () => {
    if (!code.trim()) {
      setError(t("panel.flowchartNoCode"));
      setHasResult(false);
      setWarning(null);
      setSvgContent("");
      return;
    }

    const renderId = ++renderIdRef.current;
    setLoading(true);
    setError(null);
    setWarning(null);

    try {
      const cfg = await invoke<CfgResult>("generate_cfg", { code });
      if (renderId !== renderIdRef.current) return;

      lastCfgRef.current = cfg;
      setWarning(cfg.warning);
      setLoading(false);
      setHasResult(true);
      resetTransformRef.current = true;
      await renderMermaid(renderId, cfg);
    } catch (e) {
      if (renderId === renderIdRef.current) {
        setError(formatCfgError(e, t));
        setLoading(false);
        setHasResult(false);
      }
    }
  }, [code, t, renderMermaid]);

  // 面板首次可见时自动生成
  useEffect(() => {
    if (visible && !hasResult && !loading && !error) {
      void generate();
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // 主题变化时用已有结果重新渲染
  useEffect(() => {
    if (hasResult && lastCfgRef.current) {
      const renderId = ++renderIdRef.current;
      void renderMermaid(renderId, lastCfgRef.current);
    }
  }, [mermaidTheme]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flowchart-panel">
      <div className="flowchart-toolbar">
        <button
          className="flowchart-refresh"
          onClick={() => void generate()}
          disabled={loading}
          title={t("panel.flowchartRefresh")}
        >
          {loading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
        </button>
        <button
          className="flowchart-refresh"
          onClick={() => zoomByButton(ZOOM_STEP)}
          disabled={!hasSvg || transform.scale >= MAX_SCALE}
          title={t("panel.flowchartZoomIn")}
        >
          <ZoomIn size={14} />
        </button>
        <button
          className="flowchart-refresh"
          onClick={() => zoomByButton(1 / ZOOM_STEP)}
          disabled={!hasSvg || transform.scale <= MIN_SCALE}
          title={t("panel.flowchartZoomOut")}
        >
          <ZoomOut size={14} />
        </button>
        <button
          className="flowchart-refresh"
          onClick={handleZoomReset}
          disabled={!hasSvg}
          title={t("panel.flowchartZoomReset")}
        >
          <Maximize size={14} />
        </button>
        {warning && (
          <span className="flowchart-warning">
            {t("panel.flowchartWarning", { detail: warning })}
          </span>
        )}
      </div>
      <div
        ref={contentRef}
        className="flowchart-content"
        onMouseDown={handleMouseDown}
      >
        {loading && <div className="flowchart-message">{t("panel.flowchartLoading")}</div>}
        {error && !loading && <div className="flowchart-message error">{error}</div>}
        {!loading && !error && svgContent && (
          <div
            ref={svgContainerRef}
            className="flowchart-svg-wrapper"
            style={{
              transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            }}
          />
        )}
      </div>
    </div>
  );
}

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "../hooks/useI18n";
import { hexToRgb } from "../utils/colorExtract";
import type { ExtractedColors } from "../utils/colorExtract";

interface CustomThemePreviewProps {
  colors: ExtractedColors;
  /** 图片 URL（blob: 或 asset:），用于缩略图与背景预览 */
  imageUrl: string;
  /** 初始面板透明度 50~95 */
  initialPanelAlpha: number;
  /** 初始编辑器透明度 70~100 */
  initialEditorAlpha: number;
  /** 初始图片遮罩强度 0~60 */
  initialMaskOpacity: number;
  /** 应用主题时回传 3 个滑块值 */
  onApply: (params: {
    panelAlpha: number;
    editorAlpha: number;
    maskOpacity: number;
  }) => void;
  /** 滑块实时变化时回传当前值（用于驱动主界面预览，不触发保存） */
  onSliderChange?: (params: {
    panelAlpha: number;
    editorAlpha: number;
    maskOpacity: number;
  }) => void;
  onCancel: () => void;
}

function Swatch({ label, color }: { label: string; color: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="w-10 h-10 border"
        style={{ backgroundColor: color, borderColor: "var(--border)" }}
      />
      <span
        className="text-[10px] font-mono"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </span>
      <span
        className="text-[10px] font-mono"
        style={{ color: "var(--text-muted)" }}
      >
        {color}
      </span>
    </div>
  );
}

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  accentColor: string;
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  accentColor,
}: SliderRowProps) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="text-xs w-20 flex-shrink-0"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 custom-theme-slider"
        style={{ accentColor }}
      />
      <span
        className="text-xs w-10 text-right flex-shrink-0"
        style={{ color: "var(--text-muted)" }}
      >
        {value}%
      </span>
    </div>
  );
}

// 纯受控滑块组：可被 CustomThemePreview（状态 B）和 SettingsPanel 状态 C 复用
// value + onChange，不持有内部 state
export interface CustomThemeSlidersProps {
  panelAlpha: number;
  editorAlpha: number;
  maskOpacity: number;
  /** slider accent-color（提取的 primary 色） */
  accentColor: string;
  onChange: (params: {
    panelAlpha: number;
    editorAlpha: number;
    maskOpacity: number;
  }) => void;
}

export function CustomThemeSliders({
  panelAlpha,
  editorAlpha,
  maskOpacity,
  accentColor,
  onChange,
}: CustomThemeSlidersProps) {
  const t = useI18n((s) => s.t);
  return (
    <div className="space-y-2">
      <SliderRow
        label={t("settings.panelAlpha")}
        value={panelAlpha}
        min={50}
        max={95}
        step={1}
        onChange={(v) => onChange({ panelAlpha: v, editorAlpha, maskOpacity })}
        accentColor={accentColor}
      />
      <SliderRow
        label={t("settings.editorAlpha")}
        value={editorAlpha}
        min={70}
        max={100}
        step={1}
        onChange={(v) => onChange({ panelAlpha, editorAlpha: v, maskOpacity })}
        accentColor={accentColor}
      />
      <SliderRow
        label={t("settings.maskOpacity")}
        value={maskOpacity}
        min={0}
        max={60}
        step={1}
        onChange={(v) => onChange({ panelAlpha, editorAlpha, maskOpacity: v })}
        accentColor={accentColor}
      />
    </div>
  );
}

function CustomThemePreview({
  colors,
  imageUrl,
  initialPanelAlpha,
  initialEditorAlpha,
  initialMaskOpacity,
  onApply,
  onSliderChange,
  onCancel,
}: CustomThemePreviewProps) {
  const t = useI18n((s) => s.t);
  const [panelAlpha, setPanelAlpha] = useState(initialPanelAlpha);
  const [editorAlpha, setEditorAlpha] = useState(initialEditorAlpha);
  const [maskOpacity, setMaskOpacity] = useState(initialMaskOpacity);

  // 滑块变化时同步内部 state + 通知父组件更新主题预览
  const handleSliderChange = (p: {
    panelAlpha: number;
    editorAlpha: number;
    maskOpacity: number;
  }) => {
    setPanelAlpha(p.panelAlpha);
    setEditorAlpha(p.editorAlpha);
    setMaskOpacity(p.maskOpacity);
    onSliderChange?.(p);
  };

  // 模拟面板/编辑器背景色（用提取的 bg + 当前 alpha，与 App.tsx 注入逻辑一致）
  const [br, bgg, bb] = hexToRgb(colors.bg);
  const panelBg = `rgba(${br}, ${bgg}, ${bb}, ${panelAlpha / 100})`;
  const editorBg = `rgba(${br}, ${bgg}, ${bb}, ${editorAlpha / 100})`;

  return (
    <div
      className="border p-3 space-y-3"
      style={{
        borderColor: colors.border,
        color: colors.text,
      }}
    >
      <h5 className="text-sm font-medium" style={{ color: colors.text }}>
        {t("settings.themePreview")}
      </h5>

      {/* 图片缩略图 + 遮罩 + 模拟面板预览 */}
      <div
        className="relative w-full h-32 overflow-hidden border"
        style={{
          backgroundImage: `url("${imageUrl}")`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          borderColor: colors.border,
        }}
      >
        {/* 遮罩层预览（与 global.css body::before 一致） */}
        <div
          className="absolute inset-0"
          style={{ background: `rgba(0, 0, 0, ${maskOpacity / 100})` }}
        />

        {/* 模拟编辑器区（半透明，右上） */}
        <div
          className="absolute inset-x-2 top-2 p-2 border"
          style={{
            backgroundColor: editorBg,
            borderColor: colors.border,
          }}
        >
          <div className="text-[10px] font-mono" style={{ color: colors.text_muted }}>
            {t("settings.editor")}
          </div>
          <div className="text-xs font-mono mt-0.5" style={{ color: colors.text }}>
            #include &lt;iostream&gt;
          </div>
        </div>

        {/* 模拟面板块（半透明，左下） */}
        <div
          className="absolute inset-x-2 bottom-2 p-2 border"
          style={{
            backgroundColor: panelBg,
            borderColor: colors.border,
          }}
        >
          <div className="text-xs" style={{ color: colors.text_muted }}>
            {t("settings.themePreviewPanel")}
          </div>
          <div className="text-sm flex items-center justify-between mt-0.5">
            <span style={{ color: colors.text }}>
              {t("settings.themePreviewText")}
            </span>
            <button
              className="px-2 py-0.5 text-[10px]"
              style={{
                backgroundColor: colors.primary,
                color: colors.primary_foreground,
              }}
            >
              {t("settings.themePreviewButton")}
            </button>
          </div>
        </div>
      </div>

      {/* 滑块组 */}
      <CustomThemeSliders
        panelAlpha={panelAlpha}
        editorAlpha={editorAlpha}
        maskOpacity={maskOpacity}
        accentColor={colors.primary}
        onChange={handleSliderChange}
      />

      {/* 色板 */}
      <div className="flex gap-2 flex-wrap">
        <Swatch label="BG" color={colors.bg} />
        <Swatch label="Panel" color={colors.panel_bg} />
        <Swatch label="Primary" color={colors.primary} />
        <Swatch label="Text" color={colors.text} />
        <Swatch label="Border" color={colors.border} />
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-2">
        <Button
          variant="default"
          onClick={() =>
            onApply({ panelAlpha, editorAlpha, maskOpacity })
          }
        >
          {t("settings.applyTheme")}
        </Button>
        <Button variant="compact" onClick={onCancel}>
          {t("settings.cancelTheme")}
        </Button>
      </div>
    </div>
  );
}

export default CustomThemePreview;

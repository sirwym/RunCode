import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "../hooks/useI18n";
import { hexToRgb, deriveSyntaxColors } from "../utils/colorExtract";
import type { ExtractedColors, SyntaxColors } from "../utils/colorExtract";

interface CustomThemePreviewProps {
  colors: ExtractedColors;
  /** 图片 URL（blob: 或 asset:），用于缩略图与背景预览 */
  imageUrl: string;
  /** 初始面板透明度 0~100 */
  initialPanelAlpha: number;
  /** 初始编辑器透明度 0~100 */
  initialEditorAlpha: number;
  /** 初始图片遮罩强度 0~100 */
  initialMaskOpacity: number;
  /** 应用主题时回传 3 个滑块值 + 语法色覆盖 */
  onApply: (params: {
    panelAlpha: number;
    editorAlpha: number;
    maskOpacity: number;
    syntaxOverrides: Record<string, string>;
  }) => void;
  /** 滑块实时变化时回传当前值（用于驱动主界面预览，不触发保存） */
  onSliderChange?: (params: {
    panelAlpha: number;
    editorAlpha: number;
    maskOpacity: number;
  }) => void;
  /** 色板变化时回传 5 个可编辑色（用于驱动主界面预览 + 派生色重算） */
  onColorChange?: (colors: {
    bg: string;
    panel_bg: string;
    text: string;
    border: string;
    primary: string;
  }) => void;
  /** 初始语法色手动覆盖（重导入/再次预览时保留） */
  initialSyntaxOverrides: Record<string, string>;
  /** 语法色覆盖实时变化时回传（用于驱动主界面预览，不触发保存） */
  onSyntaxChange?: (overrides: Record<string, string>) => void;
  onCancel: () => void;
}

function ColorSwatch({ label, color, onChange }: { label: string; color: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="relative w-10 h-10 border"
        style={{ backgroundColor: color, borderColor: "var(--border)" }}
      >
        <input
          type="color"
          value={color}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
        />
      </div>
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
        min={0}
        max={100}
        step={1}
        onChange={(v) => onChange({ panelAlpha: v, editorAlpha, maskOpacity })}
        accentColor={accentColor}
      />
      <SliderRow
        label={t("settings.editorAlpha")}
        value={editorAlpha}
        min={0}
        max={100}
        step={1}
        onChange={(v) => onChange({ panelAlpha, editorAlpha: v, maskOpacity })}
        accentColor={accentColor}
      />
      <SliderRow
        label={t("settings.maskOpacity")}
        value={maskOpacity}
        min={0}
        max={100}
        step={1}
        onChange={(v) => onChange({ panelAlpha, editorAlpha, maskOpacity: v })}
        accentColor={accentColor}
      />
    </div>
  );
}

// 纯受控色板组：可被 CustomThemePreview（状态 B）和 SettingsPanel 状态 C 复用
export interface CustomThemeColorPickerProps {
  bg: string;
  panel_bg: string;
  primary: string;
  text: string;
  border: string;
  onChange: (colors: {
    bg: string;
    panel_bg: string;
    text: string;
    border: string;
    primary: string;
  }) => void;
}

export function CustomThemeColorPicker({
  bg,
  panel_bg,
  primary,
  text,
  border,
  onChange,
}: CustomThemeColorPickerProps) {
  const t = useI18n((s) => s.t);
  return (
    <div className="flex gap-2 flex-wrap">
      <ColorSwatch
        label={t("settings.colorBg")}
        color={bg}
        onChange={(v) => onChange({ bg: v, panel_bg, text, border, primary })}
      />
      <ColorSwatch
        label={t("settings.colorPanel")}
        color={panel_bg}
        onChange={(v) => onChange({ bg, panel_bg: v, text, border, primary })}
      />
      <ColorSwatch
        label={t("settings.colorPrimary")}
        color={primary}
        onChange={(v) => onChange({ bg, panel_bg, text, border, primary: v })}
      />
      <ColorSwatch
        label={t("settings.colorText")}
        color={text}
        onChange={(v) => onChange({ bg, panel_bg, text: v, border, primary })}
      />
      <ColorSwatch
        label={t("settings.colorBorder")}
        color={border}
        onChange={(v) => onChange({ bg, panel_bg, text, border: v, primary })}
      />
    </div>
  );
}

// 纯受控语法色板组：可被 CustomThemePreview（状态 B）和 SettingsPanel 状态 C 复用
// colors 为生效色（overrides 已合并派生值），overrides 仅用于标记哪些 token 已自定义
export interface SyntaxColorPickerProps {
  /** 生效语法色（overrides 已合并派生值），用于显示 */
  colors: SyntaxColors;
  /** 当前手动覆盖集（决定哪些 swatch 标记"已自定义"） */
  overrides: Record<string, string>;
  onColorChange: (token: keyof SyntaxColors, color: string) => void;
  /** 整组重置（清空全部 overrides，回到自动派生） */
  onReset: () => void;
}

export function SyntaxColorPicker({
  colors,
  overrides,
  onColorChange,
  onReset,
}: SyntaxColorPickerProps) {
  const t = useI18n((s) => s.t);
  const mark = (label: string, token: keyof SyntaxColors) =>
    overrides[token] ? `${label}*` : label;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {t("settings.syntaxHighlightGroup")}
        </span>
        <Button
          variant="compact"
          disabled={Object.keys(overrides).length === 0}
          onClick={onReset}
        >
          {t("settings.resetSyntaxColors")}
        </Button>
      </div>
      <div className="flex gap-2 flex-wrap">
        <ColorSwatch
          label={mark(t("settings.syntaxKeyword"), "keyword")}
          color={colors.keyword}
          onChange={(v) => onColorChange("keyword", v)}
        />
        <ColorSwatch
          label={mark(t("settings.syntaxType"), "type")}
          color={colors.type}
          onChange={(v) => onColorChange("type", v)}
        />
        <ColorSwatch
          label={mark(t("settings.syntaxString"), "string")}
          color={colors.string}
          onChange={(v) => onColorChange("string", v)}
        />
        <ColorSwatch
          label={mark(t("settings.syntaxNumber"), "number")}
          color={colors.number}
          onChange={(v) => onColorChange("number", v)}
        />
        <ColorSwatch
          label={mark(t("settings.syntaxComment"), "comment")}
          color={colors.comment}
          onChange={(v) => onColorChange("comment", v)}
        />
        <ColorSwatch
          label={mark(t("settings.syntaxPreprocessor"), "preprocessor")}
          color={colors.preprocessor}
          onChange={(v) => onColorChange("preprocessor", v)}
        />
      </div>
      <p className="settings-hint">{t("settings.syntaxAutoHint")}</p>
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
  onColorChange,
  initialSyntaxOverrides,
  onSyntaxChange,
  onCancel,
}: CustomThemePreviewProps) {
  const t = useI18n((s) => s.t);
  const [panelAlpha, setPanelAlpha] = useState(initialPanelAlpha);
  const [editorAlpha, setEditorAlpha] = useState(initialEditorAlpha);
  const [maskOpacity, setMaskOpacity] = useState(initialMaskOpacity);
  const [syntaxOverrides, setSyntaxOverrides] = useState(initialSyntaxOverrides);

  // 生效语法色 = 自动派生 + 手动覆盖（与 Editor.tsx buildCustomMonacoRules 合成逻辑一致）
  const effSyntax: SyntaxColors = {
    ...deriveSyntaxColors(colors.bg_terminal, colors.baseMode),
    ...syntaxOverrides,
  };

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

  // 语法色变化：同步内部 state + 通知父组件更新主编辑器预览
  const handleSyntaxColorChange = (token: keyof SyntaxColors, color: string) => {
    const next = { ...syntaxOverrides, [token]: color };
    setSyntaxOverrides(next);
    onSyntaxChange?.(next);
  };

  // 整组重置：清空全部覆盖，回到自动派生
  const handleSyntaxReset = () => {
    setSyntaxOverrides({});
    onSyntaxChange?.({});
  };

  // 模拟面板/编辑器背景色（panel 用 panel_bg，editor 用 bg_terminal，与 App.tsx 注入逻辑一致）
  const [pbr, pbg, pbb] = hexToRgb(colors.panel_bg);
  const [tbr, tbg, tbb] = hexToRgb(colors.bg_terminal);
  const panelBg = `rgba(${pbr}, ${pbg}, ${pbb}, ${panelAlpha / 100})`;
  const editorBg = `rgba(${tbr}, ${tbg}, ${tbb}, ${editorAlpha / 100})`;

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
          {/* 示例代码用生效语法色着色（派生 + 覆盖），实时反映语法色调整 */}
          <div className="text-xs font-mono mt-0.5 leading-snug" style={{ color: colors.text }}>
            <div>
              <span style={{ color: effSyntax.preprocessor }}>#include</span>{" "}
              <span style={{ color: effSyntax.string }}>&lt;iostream&gt;</span>
            </div>
            <div>
              <span style={{ color: effSyntax.keyword }}>int</span> main() {"{"}
            </div>
            <div>
              {"  "}
              <span style={{ color: effSyntax.keyword }}>return</span>{" "}
              <span style={{ color: effSyntax.number }}>0</span>;
            </div>
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
      <CustomThemeColorPicker
        bg={colors.bg}
        panel_bg={colors.panel_bg}
        primary={colors.primary}
        text={colors.text}
        border={colors.border}
        onChange={(c) => onColorChange?.(c)}
      />

      {/* 语法高亮色板 */}
      <SyntaxColorPicker
        colors={effSyntax}
        overrides={syntaxOverrides}
        onColorChange={handleSyntaxColorChange}
        onReset={handleSyntaxReset}
      />

      {/* 操作按钮 */}
      <div className="flex gap-2">
        <Button
          variant="default"
          onClick={() =>
            onApply({ panelAlpha, editorAlpha, maskOpacity, syntaxOverrides })
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

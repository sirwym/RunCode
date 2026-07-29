import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useSettings } from "../hooks/useSettings";
import { useI18n, type Locale } from "../hooks/useI18n";
import type { AppSettings, CustomThemeConfig } from "../types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import CustomThemePreview, { CustomThemeSliders, CustomThemeColorPicker } from "./CustomThemePreview";
import {
  extractThemeColors,
  loadImageToImageData,
  rederiveColors,
  type ExtractedColors,
} from "../utils/colorExtract";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

type Section = "general" | "editor" | "language" | "shortcuts";

const CPP_STANDARDS = ["c++11", "c++14", "c++17", "c++20"];
const OPT_LEVELS = ["O0", "O1", "O2", "O3"];
const WARNING_LEVELS = [
  { value: "none", labelKey: "settings.warningsNone" },
  { value: "wall", label: "-Wall" },
  { value: "wall_extra", label: "-Wall -Wextra" },
];

// 平台检测：Windows/Linux 下快捷键显示 Ctrl，macOS 下显示 Cmd
const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

// 快捷键平台专属定义（与 lib.rs 菜单、TitleBar、App keydown 对齐）
// macKeys / windowsKeys 缺省表示该平台无此快捷键
interface ShortcutDefinition {
  category: "file" | "edit" | "find" | "view" | "app";
  action: string;
  macKeys?: string;
  windowsKeys?: string;
}

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  // 文件
  { category: "file", action: "menu.new", macKeys: "Cmd+N", windowsKeys: "Ctrl+N" },
  { category: "file", action: "menu.open", macKeys: "Cmd+O", windowsKeys: "Ctrl+O" },
  { category: "file", action: "menu.save", macKeys: "Cmd+S", windowsKeys: "Ctrl+S" },
  { category: "file", action: "menu.saveAs", macKeys: "Cmd+Shift+S", windowsKeys: "Ctrl+Shift+S" },
  { category: "file", action: "menu.close", macKeys: "Cmd+W", windowsKeys: "Ctrl+W" },
  { category: "file", action: "menu.closeAll", macKeys: "Cmd+Shift+W", windowsKeys: "Ctrl+Shift+W" },
  // 编辑（macOS 重做为 Cmd+Shift+Z，Windows 重做为 Ctrl+Y）
  { category: "edit", action: "menu.undo", macKeys: "Cmd+Z", windowsKeys: "Ctrl+Z" },
  { category: "edit", action: "menu.redo", macKeys: "Cmd+Shift+Z", windowsKeys: "Ctrl+Y" },
  { category: "edit", action: "menu.cut", macKeys: "Cmd+X", windowsKeys: "Ctrl+X" },
  { category: "edit", action: "menu.copy", macKeys: "Cmd+C", windowsKeys: "Ctrl+C" },
  { category: "edit", action: "menu.paste", macKeys: "Cmd+V", windowsKeys: "Ctrl+V" },
  { category: "edit", action: "menu.selectAll", macKeys: "Cmd+A", windowsKeys: "Ctrl+A" },
  { category: "edit", action: "menu.format", macKeys: "Shift+Alt+F", windowsKeys: "Shift+Alt+F" },
  // 查找
  { category: "find", action: "menu.findFind", macKeys: "Cmd+F", windowsKeys: "Ctrl+F" },
  // Windows 的 Find Next 未由 App 接管（Ctrl+G 实际执行跳转行），故不显示
  { category: "find", action: "menu.findNext", macKeys: "Cmd+G" },
  { category: "find", action: "menu.findPrev", macKeys: "Cmd+Shift+G", windowsKeys: "Ctrl+Shift+G" },
  { category: "find", action: "menu.replace", macKeys: "Cmd+Alt+F", windowsKeys: "Ctrl+Alt+F" },
  // 跳转行：两平台均为 Ctrl+G（macOS 原生菜单也用字面 Ctrl+G）
  { category: "find", action: "menu.gotoLine", macKeys: "Ctrl+G", windowsKeys: "Ctrl+G" },
  // 视图
  { category: "view", action: "menu.fontInc", macKeys: "Cmd+=", windowsKeys: "Ctrl+=" },
  { category: "view", action: "menu.fontDec", macKeys: "Cmd+-", windowsKeys: "Ctrl+-" },
  { category: "view", action: "menu.fontReset", macKeys: "Cmd+0", windowsKeys: "Ctrl+0" },
  { category: "view", action: "menu.togglePanel", macKeys: "Cmd+\\", windowsKeys: "Ctrl+\\" },
  // 应用（DevTools：macOS Cmd+Alt+I，Windows Ctrl+Shift+I）
  { category: "app", action: "menu.settings", macKeys: "Cmd+,", windowsKeys: "Ctrl+," },
  { category: "app", action: "menu.toggleDevtools", macKeys: "Cmd+Alt+I", windowsKeys: "Ctrl+Shift+I" },
];

// 按平台筛选并展平为带 keys 的只读展示列表
export function getShortcuts(isMac: boolean) {
  return SHORTCUT_DEFINITIONS.flatMap((item) => {
    const keys = isMac ? item.macKeys : item.windowsKeys;
    return keys ? [{ ...item, keys }] : [];
  });
}

export const SHORTCUT_CATEGORY_KEY: Record<string, string> = {
  file: "settings.shortcutFile",
  edit: "settings.shortcutEdit",
  find: "settings.shortcutFind",
  view: "settings.shortcutView",
  app: "settings.shortcutApp",
};

function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const t = useI18n((s) => s.t);
  const settings = useSettings((s) => s.settings);
  const load = useSettings((s) => s.load);
  const saveSettings = useSettings((s) => s.save);
  const saving = useSettings((s) => s.saving);
  const setThemePreview = useSettings((s) => s.setThemePreview);
  const clearThemePreview = useSettings((s) => s.clearThemePreview);

  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [section, setSection] = useState<Section>("general");
  const [msg, setMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const msgTimerRef = useRef<number | null>(null);
  // 自定义图片主题状态
  const [previewColors, setPreviewColors] = useState<ExtractedColors | null>(null);
  const [pendingImagePath, setPendingImagePath] = useState<string | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  // blob URL ref，避免内存泄漏（切换图片/卸载时 revoke）
  const previewBlobUrlRef = useRef<string | null>(null);
  // 图片文件事务状态：
  // - stagedImageFile: 本次"应用主题"新建但未保存的图片文件名（取消/关闭时需删除）
  // - pendingDeleteImageFile: 切换到预设主题后，待 save_settings 成功才删除的旧图片
  // - originalImageFile: 打开面板时已持久化的图片（取消时保留）
  const [stagedImageFile, setStagedImageFile] = useState<string | null>(null);
  const stagedImageFileRef = useRef<string | null>(null);
  stagedImageFileRef.current = stagedImageFile;
  const [pendingDeleteImageFile, setPendingDeleteImageFile] = useState<string | null>(null);
  const originalImageFileRef = useRef<string | null>(null);
  // 追踪图片提取的原始颜色（用于重置功能）
  // - 导入图片时设置为 extractThemeColors 返回值
  // - 打开面板时从持久化 settings 初始化
  const originalColorsRef = useRef<ExtractedColors | null>(null);

  useEffect(() => {
    if (open) {
      void load();
      setMsg(null);
      setErrorMsg(null);
      // 重置预览状态（每次打开面板时清空，避免脏状态）
      setPreviewColors(null);
      setPendingImagePath(null);
      if (previewBlobUrlRef.current) {
        URL.revokeObjectURL(previewBlobUrlRef.current);
        previewBlobUrlRef.current = null;
      }
      setPreviewImageUrl(null);
      setExtracting(false);
      // 重置图片事务状态
      setStagedImageFile(null);
      setPendingDeleteImageFile(null);
      // 记录打开面板时已持久化的图片文件名（取消时保留）
      originalImageFileRef.current = settings?.general.custom_theme?.image_file ?? null;
      // 初始化 originalColorsRef：从持久化 custom_theme 读取（用于重置功能）
      if (settings?.general.custom_theme) {
        originalColorsRef.current = {
          ...settings.general.custom_theme.colors,
          baseMode: settings.general.custom_theme.base_mode as "dark" | "light",
        };
      } else {
        originalColorsRef.current = null;
      }
      // 清除主题预览：打开面板时主界面保持持久化主题
      // （上次异常退出可能残留 themePreview）
      clearThemePreview();
    }
  }, [open, load]);

  // 组件卸载时清理消息定时器 + blob URL + 未提交的暂存图片
  useEffect(() => () => {
    if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
    if (previewBlobUrlRef.current) {
      URL.revokeObjectURL(previewBlobUrlRef.current);
      previewBlobUrlRef.current = null;
    }
    // 清理未提交的暂存图片（组件卸载 = 关闭面板 = 取消）
    const staged = stagedImageFileRef.current;
    if (staged) {
      void invoke("delete_custom_theme_image", { imageFile: staged }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (settings) setDraft(structuredClone(settings));
  }, [settings]);

  // 同步主题预览到 useSettings.themePreview
  // customTheme 为 null 时清除预览（回退到持久化 settings）
  // imageUrl 非空时用 blob URL 作为背景图（新导入未保存的图片）
  const syncThemePreview = (
    customTheme: CustomThemeConfig | null | undefined,
    imageUrl?: string,
  ) => {
    if (customTheme) {
      setThemePreview({ customTheme, imageUrl });
    } else {
      clearThemePreview();
    }
  };

  const updateGeneral = (k: keyof AppSettings["general"], v: string | number) => {
    setDraft((d) => {
      if (!d) return d;
      const newGeneral = { ...d.general, [k]: v };

      // 切换到预设主题时，不立即删除图片文件
      // 标记为 pendingDeleteImageFile，待 save_settings 成功后才删除
      // 这样取消/关闭时不会删除已持久化的图片
      if (k === "theme" && v !== "custom") {
        const existingCustomTheme = d.general.custom_theme;
        if (existingCustomTheme) {
          // 仅当此图片是已持久化的（非本次暂存）才标记待删除
          // 暂存图片（stagedImageFile）由关闭面板时清理
          if (existingCustomTheme.image_file !== stagedImageFileRef.current) {
            setPendingDeleteImageFile(existingCustomTheme.image_file);
          }
        }
        newGeneral.custom_theme = undefined;
        // 切换到预设主题：清除预览，主界面回退到持久化主题（取消时恢复）
        syncThemePreview(null);
      }

      return { ...d, general: newGeneral };
    });
  };

  // 导入图片：文件选择 → 读取字节 → Canvas 提取颜色 → 进入预览状态
  // 保留滑块值（panelAlpha/editorAlpha/maskOpacity 不重置）
  const handleImportImage = async () => {
    setErrorMsg(null);
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (typeof selected !== "string") return; // 用户取消

    setExtracting(true);
    try {
      // 1. 读取图片字节（后端校验扩展名 + 大小）
      const bytes = await invoke<number[]>("read_file_bytes", { path: selected });
      const blob = new Blob([new Uint8Array(bytes)]);
      const url = URL.createObjectURL(blob);

      // 2. Canvas 提取颜色
      const imageData = await loadImageToImageData(url);
      const colors = extractThemeColors(imageData);

      // 3. revoke 上一次的 blob URL（避免内存泄漏）
      if (previewBlobUrlRef.current) {
        URL.revokeObjectURL(previewBlobUrlRef.current);
      }
      previewBlobUrlRef.current = url;

      // 4. 进入预览状态（不立即应用，保留滑块值）
      setPreviewColors(colors);
      setPendingImagePath(selected);
      setPreviewImageUrl(url);
      // 记录提取的原始颜色（用于后续重置功能）
      originalColorsRef.current = colors;

      // 5. 立即驱动主界面预览：用 blob URL + 提取的颜色 + 当前 draft 滑块值构造临时 customTheme
      // 滑块值优先用 draft 中已有的 custom_theme 值（重新导入保留），否则用默认值
      const draftCt = draft?.general.custom_theme;
      const previewCt: CustomThemeConfig = {
        image_file: "__preview__", // 临时标记，App 会用 imageUrl 作为背景
        colors: {
          bg: colors.bg,
          panel_bg: colors.panel_bg,
          panel_bg_alt: colors.panel_bg_alt,
          text: colors.text,
          text_muted: colors.text_muted,
          border: colors.border,
          primary: colors.primary,
          primary_hover: colors.primary_hover,
          primary_foreground: colors.primary_foreground,
          primary_soft: colors.primary_soft,
          primary_border: colors.primary_border,
          bg_terminal: colors.bg_terminal,
        },
        base_mode: colors.baseMode,
        panel_alpha: draftCt?.panel_alpha ?? 82,
        editor_alpha: draftCt?.editor_alpha ?? 92,
        mask_opacity: draftCt?.mask_opacity ?? 20,
      };
      syncThemePreview(previewCt, url);
    } catch (e) {
      setErrorMsg(t("settings.themeExtractFailed", { detail: String(e) }));
    } finally {
      setExtracting(false);
    }
  };

  // 应用主题：保存图片到 app_data + 更新 draft（未落盘）
  // 接受 onApply 返回的三个滑块参数，原子写入 draft（不依赖 setState 后的父状态）
  // 旧暂存图片（若存在）在新建图片成功后清理
  const handleApplyCustomTheme = async (params: {
    panelAlpha: number;
    editorAlpha: number;
    maskOpacity: number;
  }) => {
    if (!previewColors || !pendingImagePath) return;

    try {
      // 1. 保存图片到 app_data_dir/custom_themes/
      const imageFile = await invoke<string>("save_custom_theme_image", {
        sourcePath: pendingImagePath,
      });

      // 2. 清理上一次的暂存图片（重新导入场景：旧暂存图片不再需要）
      const oldStaged = stagedImageFileRef.current;
      if (oldStaged && oldStaged !== imageFile) {
        void invoke("delete_custom_theme_image", { imageFile: oldStaged }).catch(() => {});
      }

      // 2.1 标记旧持久化图片待删除（重新导入场景：旧图片不再被新配置引用）
      // 仅在 save 成功后才删除，取消/关闭时保留原图片
      // 如果已有 pendingDeleteImageFile（切换预设场景），不覆盖
      const oldPersisted = originalImageFileRef.current;
      if (oldPersisted && oldPersisted !== imageFile && oldPersisted !== oldStaged) {
        setPendingDeleteImageFile((prev) => prev ?? oldPersisted);
      }

      // 3. 更新 draft（未落盘，需用户点底部"保存"才生效）
      // 使用 params 中的滑块值（来自 onApply 回调），而非父组件 state（避免 setState 竞态）
      const newCustomTheme: CustomThemeConfig = {
        image_file: imageFile,
        colors: {
          bg: previewColors.bg,
          panel_bg: previewColors.panel_bg,
          panel_bg_alt: previewColors.panel_bg_alt,
          text: previewColors.text,
          text_muted: previewColors.text_muted,
          border: previewColors.border,
          primary: previewColors.primary,
          primary_hover: previewColors.primary_hover,
          primary_foreground: previewColors.primary_foreground,
          primary_soft: previewColors.primary_soft,
          primary_border: previewColors.primary_border,
          bg_terminal: previewColors.bg_terminal,
        },
        base_mode: previewColors.baseMode,
        panel_alpha: params.panelAlpha,
        editor_alpha: params.editorAlpha,
        mask_opacity: params.maskOpacity,
      };
      setDraft((d) =>
        d
          ? {
              ...d,
              general: {
                ...d.general,
                theme: "custom",
                custom_theme: newCustomTheme,
              },
            }
          : d
      );

      // 4. 记录本次暂存图片（取消/关闭时清理）
      setStagedImageFile(imageFile);

      // 5. 同步主题预览：用 draft 中的真实 image_file + blob URL（保存前持久化路径不可用）
      // 保存成功后由新持久化配置接管，clearThemePreview 会让 App 回退到持久化路径
      syncThemePreview(newCustomTheme, previewBlobUrlRef.current ?? undefined);

      // 6. 清理预览状态（保留滑块值，符合"重新导入保留"需求）
      setPreviewColors(null);
      setPendingImagePath(null);
      // 注意：不 revoke blob URL，因为 themePreview 仍在用它
      setPreviewImageUrl(null);
    } catch (e) {
      setErrorMsg(t("settings.themeApplyFailed", { detail: String(e) }));
    }
  };

  // 取消预览：清空状态，无副作用
  // 主题预览回退到 draft 中的 custom_theme（若有），否则清除预览
  const handleCancelPreview = () => {
    setPreviewColors(null);
    setPendingImagePath(null);
    if (previewBlobUrlRef.current) {
      URL.revokeObjectURL(previewBlobUrlRef.current);
      previewBlobUrlRef.current = null;
    }
    setPreviewImageUrl(null);
    // 回退到 draft 的 custom_theme（用持久化路径，不传 imageUrl）
    syncThemePreview(draft?.general.custom_theme ?? null);
  };

  // State C：色板变更 → rederiveColors 重算 12 色 → 更新 draft + 同步预览
  const handleColorChange = (c: {
    bg: string; panel_bg: string; text: string; border: string; primary: string;
  }) => {
    const ct = draft?.general.custom_theme;
    if (!ct) return;
    const newColors = rederiveColors(c, ct.base_mode as "dark" | "light");
    setDraft((d) =>
      d && d.general.custom_theme
        ? {
            ...d,
            general: {
              ...d.general,
              custom_theme: { ...d.general.custom_theme, colors: newColors },
            },
          }
        : d
    );
    syncThemePreview(
      { ...ct, colors: newColors },
      previewBlobUrlRef.current ?? undefined,
    );
  };

  // State C：重置为提取色（从 originalColorsRef 恢复）
  const handleResetColors = () => {
    const original = originalColorsRef.current;
    const ct = draft?.general.custom_theme;
    if (!original || !ct) return;
    const { baseMode: _baseMode, ...originalColors } = original;
    void _baseMode;
    setDraft((d) =>
      d && d.general.custom_theme
        ? {
            ...d,
            general: {
              ...d.general,
              custom_theme: { ...d.general.custom_theme, colors: originalColors },
            },
          }
        : d
    );
    syncThemePreview(
      { ...ct, colors: originalColors },
      previewBlobUrlRef.current ?? undefined,
    );
  };

  const updateEditor = (
    k: keyof AppSettings["editor"],
    v: string | number | boolean
  ) => setDraft((d) => (d ? { ...d, editor: { ...d.editor, [k]: v } } : d));
  const updateRuntime = (k: keyof AppSettings["runtime"], v: number) =>
    setDraft((d) => (d ? { ...d, runtime: { ...d.runtime, [k]: v } } : d));
  const updateTest = (k: keyof AppSettings["test"], v: number | string) =>
    setDraft((d) => (d ? { ...d, test: { ...d.test, [k]: v } } : d));
  const updateCompiler = (k: keyof AppSettings["compiler"], v: string) =>
    setDraft((d) => (d ? { ...d, compiler: { ...d.compiler, [k]: v } } : d));

  const handleSave = async () => {
    if (!draft) return;
    setMsg(null);
    setErrorMsg(null);
    try {
      // 主题合并：editor.theme 由 general.theme 派生，UI 上不再独立选择
      // custom 主题的 editor.theme 由 base_mode 决定（作为 Monaco base 兜底）
      if (draft.general.theme === "custom" && draft.general.custom_theme) {
        draft.editor.theme =
          draft.general.custom_theme.base_mode === "light" ? "vs" : "vs-dark";
      } else {
        draft.editor.theme = draft.general.theme === "light" ? "vs" : "vs-dark";
      }
      await saveSettings(draft);
      // 保存成功后：删除不再被引用的旧图片（切换到预设主题场景）
      const toDelete = pendingDeleteImageFile;
      if (toDelete) {
        // 确保新配置不再引用此文件
        const stillReferenced = draft.general.custom_theme?.image_file === toDelete;
        if (!stillReferenced) {
          void invoke("delete_custom_theme_image", { imageFile: toDelete }).catch(() => {});
        }
        setPendingDeleteImageFile(null);
      }
      // 暂存图片已成功保存为持久化，清理暂存标记
      setStagedImageFile(null);
      originalImageFileRef.current = draft.general.custom_theme?.image_file ?? null;
      // 保存成功：清除主题预览，让 App 用新持久化配置接管渲染
      // 必须在 saveSettings 成功后清除，避免闪回旧主题
      clearThemePreview();
      // 清理 blob URL（预览已结束，持久化图片走 asset:// 路径）
      if (previewBlobUrlRef.current) {
        URL.revokeObjectURL(previewBlobUrlRef.current);
        previewBlobUrlRef.current = null;
      }
      useI18n.getState().setLocale(draft.general.locale as Locale);
      setMsg(t("settings.saved"));
      // 3 秒后自动清空成功消息
      if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
      msgTimerRef.current = window.setTimeout(() => {
        setMsg(null);
        msgTimerRef.current = null;
      }, 3000);
    } catch (e) {
      // 保存失败：保留 draft 和预览，让用户可继续调整
      setErrorMsg(t("settings.saveFailed", { detail: String(e) }));
    }
  };

  const handleClearRecent = async () => {
    await invoke("clear_recent_files").catch(() => {});
    setMsg(t("recent.cleared", { title: t("recent.title") }));
  };

  // 关闭面板：清理本次新建但未保存的暂存图片（保留已持久化的原图片）
  // 不删除 pendingDeleteImageFile（因为 save 未成功，原图片仍在使用）
  // 清除主题预览，主界面回退到持久化 settings
  const handleClose = () => {
    const staged = stagedImageFileRef.current;
    if (staged) {
      void invoke("delete_custom_theme_image", { imageFile: staged }).catch(() => {});
      setStagedImageFile(null);
    }
    setPendingDeleteImageFile(null);
    // 清理预览状态
    if (previewBlobUrlRef.current) {
      URL.revokeObjectURL(previewBlobUrlRef.current);
      previewBlobUrlRef.current = null;
    }
    setPreviewColors(null);
    setPendingImagePath(null);
    setPreviewImageUrl(null);
    // 清除主题预览，主界面回退到持久化 settings（取消/关闭/Escape 都走这里）
    clearThemePreview();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="w-[min(720px,calc(100vw-32px))] h-[min(600px,calc(100vh-32px))] max-w-none max-h-none p-0 flex flex-col">
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-border flex-shrink-0">
          <DialogTitle>{t("settings.title")}</DialogTitle>
        </DialogHeader>

        {draft && (
          <div className="flex-1 min-h-0 flex flex-col px-6 py-4">
            <Tabs
              value={section}
              onValueChange={(v) => setSection(v as Section)}
              className="w-full flex-1 min-h-0 flex flex-col"
            >
              <TabsList className="grid w-full grid-cols-4 flex-shrink-0">
                <TabsTrigger value="general">
                  {t("settings.general")}
                </TabsTrigger>
                <TabsTrigger value="editor">{t("settings.editor")}</TabsTrigger>
                <TabsTrigger value="language">
                  {t("settings.languageSettings")}
                </TabsTrigger>
                <TabsTrigger value="shortcuts">
                  {t("settings.shortcuts")}
                </TabsTrigger>
              </TabsList>

              <div className="flex-1 min-h-0 overflow-y-auto pr-1 mt-4">
                {/* ========== 通用设置 Tab ========== */}
                <TabsContent
                  value="general"
                  className="space-y-3 mt-0"
                >
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-locale">{t("settings.language")}</Label>
                    <Select
                      value={draft.general.locale}
                      onValueChange={(v) => updateGeneral("locale", v)}
                    >
                      <SelectTrigger id="set-locale">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(["zh", "en"] as Locale[]).map((l) => (
                          <SelectItem key={l} value={l}>
                            {t(`locale.${l}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-theme">{t("settings.appTheme")}</Label>
                    <Select
                      value={draft.general.theme}
                      onValueChange={(v) => updateGeneral("theme", v)}
                    >
                      <SelectTrigger id="set-theme">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="dark">
                          {t("settings.themeDark")}
                        </SelectItem>
                        <SelectItem value="light">
                          {t("settings.themeLight")}
                        </SelectItem>
                        <SelectItem value="system">
                          {t("settings.themeSystem")}
                        </SelectItem>
                        <SelectItem value="custom">
                          {t("settings.themeCustom")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* 自定义图片主题：仅在选中 custom 时显示 */}
                  {draft.general.theme === "custom" && (
                    <div className="grid grid-cols-[160px_1fr] items-start gap-3">
                      <Label>{t("settings.customThemeLabel")}</Label>
                      <div className="space-y-3">
                        {/* 状态 A：未导入 */}
                        {!draft.general.custom_theme && !previewColors && (
                          <Button
                            variant="compact"
                            onClick={() => void handleImportImage()}
                            disabled={extracting}
                          >
                            {extracting
                              ? t("settings.themeExtracting")
                              : t("settings.importImage")}
                          </Button>
                        )}

                        {/* 状态 B：预览中（图片缩略图 + 滑块） */}
                        {previewColors && previewImageUrl && (
                          <CustomThemePreview
                            colors={previewColors}
                            imageUrl={previewImageUrl}
                            initialPanelAlpha={draft?.general.custom_theme?.panel_alpha ?? 82}
                            initialEditorAlpha={draft?.general.custom_theme?.editor_alpha ?? 92}
                            initialMaskOpacity={draft?.general.custom_theme?.mask_opacity ?? 20}
                            onApply={(params) => {
                              // 原子传递 params 给 handleApplyCustomTheme
                              void handleApplyCustomTheme(params);
                            }}
                            onSliderChange={(params) => {
                              // 滑块实时变化：同步主题预览（用 previewColors + blob URL）
                              const previewCt: CustomThemeConfig = {
                                image_file: "__preview__",
                                colors: {
                                  bg: previewColors.bg,
                                  panel_bg: previewColors.panel_bg,
                                  panel_bg_alt: previewColors.panel_bg_alt,
                                  text: previewColors.text,
                                  text_muted: previewColors.text_muted,
                                  border: previewColors.border,
                                  primary: previewColors.primary,
                                  primary_hover: previewColors.primary_hover,
                                  primary_foreground: previewColors.primary_foreground,
                                  primary_soft: previewColors.primary_soft,
                                  primary_border: previewColors.primary_border,
                                  bg_terminal: previewColors.bg_terminal,
                                },
                                base_mode: previewColors.baseMode,
                                panel_alpha: params.panelAlpha,
                                editor_alpha: params.editorAlpha,
                                mask_opacity: params.maskOpacity,
                              };
                              syncThemePreview(previewCt, previewImageUrl ?? undefined);
                            }}
                            onColorChange={(c) => {
                              // 色板变化：rederiveColors 重算 12 色 → 更新 previewColors → 同步主界面预览
                              const newColors: ExtractedColors = {
                                ...rederiveColors(c, previewColors.baseMode),
                                baseMode: previewColors.baseMode,
                              };
                              setPreviewColors(newColors);
                              const draftCt = draft?.general.custom_theme;
                              const previewCt: CustomThemeConfig = {
                                image_file: "__preview__",
                                colors: { ...newColors },
                                base_mode: newColors.baseMode,
                                panel_alpha: draftCt?.panel_alpha ?? 82,
                                editor_alpha: draftCt?.editor_alpha ?? 92,
                                mask_opacity: draftCt?.mask_opacity ?? 20,
                              };
                              syncThemePreview(previewCt, previewImageUrl ?? undefined);
                            }}
                            onCancel={handleCancelPreview}
                          />
                        )}

                        {/* 状态 C：已导入（待保存）—— 滑块直接绑定 draft，随时可调 */}
                        {draft.general.custom_theme && !previewColors && (
                          <div className="space-y-3">
                            <div className="text-sm flex items-center gap-2">
                              <span className="text-[var(--success)]">✓</span>
                              <span>
                                {t("settings.themeCustomApplied", {
                                  file: draft.general.custom_theme.image_file,
                                })}
                              </span>
                            </div>
                            <CustomThemeSliders
                              panelAlpha={draft.general.custom_theme.panel_alpha}
                              editorAlpha={draft.general.custom_theme.editor_alpha}
                              maskOpacity={draft.general.custom_theme.mask_opacity}
                              accentColor={draft.general.custom_theme.colors.primary}
                              onChange={(params) => {
                                // 同时更新 draft（保存时用）和 themePreview（实时预览用）
                                setDraft((d) =>
                                  d && d.general.custom_theme
                                    ? {
                                        ...d,
                                        general: {
                                          ...d.general,
                                          custom_theme: {
                                            ...d.general.custom_theme,
                                            panel_alpha: params.panelAlpha,
                                            editor_alpha: params.editorAlpha,
                                            mask_opacity: params.maskOpacity,
                                          },
                                        },
                                      }
                                    : d
                                );
                                // 同步主题预览（用 draft 的 custom_theme + blob URL 若有）
                                const base = draft.general.custom_theme;
                                if (base) {
                                  const updatedCt: CustomThemeConfig = {
                                    ...base,
                                    panel_alpha: params.panelAlpha,
                                    editor_alpha: params.editorAlpha,
                                    mask_opacity: params.maskOpacity,
                                  };
                                  syncThemePreview(updatedCt, previewBlobUrlRef.current ?? undefined);
                                }
                              }}
                            />
                            <CustomThemeColorPicker
                              bg={draft.general.custom_theme.colors.bg}
                              panel_bg={draft.general.custom_theme.colors.panel_bg}
                              primary={draft.general.custom_theme.colors.primary}
                              text={draft.general.custom_theme.colors.text}
                              border={draft.general.custom_theme.colors.border}
                              onChange={handleColorChange}
                            />
                            <Button
                              variant="compact"
                              onClick={handleResetColors}
                            >
                              {t("settings.resetColors")}
                            </Button>
                            <Button
                              variant="compact"
                              onClick={() => void handleImportImage()}
                              disabled={extracting}
                            >
                              {t("settings.reimportImage")}
                            </Button>
                            <p className="settings-hint">
                              {t("settings.themeCustomSaveHint")}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <h4 className="settings-section-title pt-2">
                    {t("settings.dataManagement")}
                  </h4>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <span />
                    <Button
                      variant="compact"
                      onClick={() => void handleClearRecent()}
                    >
                      {t("recent.clear")}
                    </Button>
                  </div>
                </TabsContent>

                {/* ========== 编辑器设置 Tab ========== */}
                <TabsContent value="editor" className="space-y-3 mt-0">
                  <h4 className="settings-section-title">
                    {t("settings.editorFontSection")}
                  </h4>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-editor-font-size">
                      {t("settings.fontSize")}
                    </Label>
                    <Input
                      id="set-editor-font-size"
                      type="number"
                      min={8}
                      max={32}
                      className="w-32"
                      value={draft.editor.font_size}
                      onChange={(e) =>
                        updateEditor("font_size", Number(e.target.value))
                      }
                    />
                  </div>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-term-font-size">
                      {t("settings.terminalFontSize")}
                    </Label>
                    <Input
                      id="set-term-font-size"
                      type="number"
                      min={8}
                      max={32}
                      className="w-32"
                      value={draft.editor.terminal_font_size}
                      onChange={(e) =>
                        updateEditor(
                          "terminal_font_size",
                          Number(e.target.value)
                        )
                      }
                    />
                  </div>

                  <h4 className="settings-section-title pt-2">
                    {t("settings.editorBehaviorSection")}
                  </h4>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-indent-style">
                      {t("settings.indentStyle")}
                    </Label>
                    <Select
                      value={draft.editor.indent_style}
                      onValueChange={(v) => updateEditor("indent_style", v)}
                    >
                      <SelectTrigger id="set-indent-style">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="space">
                          {t("settings.indentSpace")}
                        </SelectItem>
                        <SelectItem value="tab">
                          {t("settings.indentTab")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-indent-size">
                      {t("settings.indentSize")}
                    </Label>
                    <Input
                      id="set-indent-size"
                      type="number"
                      min={2}
                      max={8}
                      className="w-32"
                      value={draft.editor.indent_size}
                      onChange={(e) =>
                        updateEditor("indent_size", Number(e.target.value))
                      }
                    />
                  </div>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-line-numbers">
                      {t("settings.lineNumbers")}
                    </Label>
                    <Select
                      value={draft.editor.line_numbers}
                      onValueChange={(v) => updateEditor("line_numbers", v)}
                    >
                      <SelectTrigger id="set-line-numbers">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="on">
                          {t("settings.lineNumbersOn")}
                        </SelectItem>
                        <SelectItem value="off">
                          {t("settings.lineNumbersOff")}
                        </SelectItem>
                        <SelectItem value="relative">
                          {t("settings.lineNumbersRelative")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-word-wrap">
                      {t("settings.wordWrap")}
                    </Label>
                    <Select
                      value={draft.editor.word_wrap}
                      onValueChange={(v) => updateEditor("word_wrap", v)}
                    >
                      <SelectTrigger id="set-word-wrap">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="on">
                          {t("settings.wordWrapOn")}
                        </SelectItem>
                        <SelectItem value="off">
                          {t("settings.wordWrapOff")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <h4 className="settings-section-title pt-2">
                    {t("settings.editorSmartSection")}
                  </h4>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-suggest">
                      {t("settings.enableSuggestions")}
                    </Label>
                    <Switch
                      id="set-suggest"
                      checked={draft.editor.enable_suggestions}
                      onCheckedChange={(v) =>
                        updateEditor("enable_suggestions", v)
                      }
                    />
                  </div>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-brackets">
                      {t("settings.autoClosingBrackets")}
                    </Label>
                    <Switch
                      id="set-brackets"
                      checked={draft.editor.auto_closing_brackets}
                      onCheckedChange={(v) =>
                        updateEditor("auto_closing_brackets", v)
                      }
                    />
                  </div>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-quotes">
                      {t("settings.autoClosingQuotes")}
                    </Label>
                    <Switch
                      id="set-quotes"
                      checked={draft.editor.auto_closing_quotes}
                      onCheckedChange={(v) =>
                        updateEditor("auto_closing_quotes", v)
                      }
                    />
                  </div>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-minimap">{t("settings.minimap")}</Label>
                    <Switch
                      id="set-minimap"
                      checked={draft.editor.minimap_enabled}
                      onCheckedChange={(v) =>
                        updateEditor("minimap_enabled", v)
                      }
                    />
                  </div>
                </TabsContent>

                {/* ========== 编程语言设置 Tab ========== */}
                <TabsContent value="language" className="space-y-3 mt-0">
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-cur-lang">
                      {t("settings.currentLanguage")}
                    </Label>
                    <Select
                      value={draft.current_language}
                      onValueChange={(v) =>
                        setDraft((d) =>
                          d ? { ...d, current_language: v } : d
                        )
                      }
                    >
                      <SelectTrigger id="set-cur-lang">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cpp">C++</SelectItem>
                        <SelectItem value="python" disabled>
                          Python ({t("settings.comingSoon")})
                        </SelectItem>
                        <SelectItem value="java" disabled>
                          Java ({t("settings.comingSoon")})
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <h4 className="settings-section-title pt-2">
                    {t("settings.compiler")}
                  </h4>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-compiler-path">
                      {t("settings.compilerPath")}
                    </Label>
                    <Input
                      id="set-compiler-path"
                      type="text"
                      placeholder={t("settings.compilerPathHint")}
                      value={draft.compiler.compiler_path ?? ""}
                      onChange={(e) =>
                        updateCompiler("compiler_path", e.target.value)
                      }
                    />
                  </div>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-cpp-std">
                      {t("settings.cppStandard")}
                    </Label>
                    <Select
                      value={draft.compiler.cpp_standard}
                      onValueChange={(v) => updateCompiler("cpp_standard", v)}
                    >
                      <SelectTrigger id="set-cpp-std">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CPP_STANDARDS.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-opt-level">
                      {t("settings.optLevel")}
                    </Label>
                    <Select
                      value={draft.compiler.opt_level}
                      onValueChange={(v) => updateCompiler("opt_level", v)}
                    >
                      <SelectTrigger id="set-opt-level">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {OPT_LEVELS.map((s) => (
                          <SelectItem key={s} value={s}>
                            -{s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-warnings">
                      {t("settings.warnings")}
                    </Label>
                    <Select
                      value={draft.compiler.warnings}
                      onValueChange={(v) => updateCompiler("warnings", v)}
                    >
                      <SelectTrigger id="set-warnings">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {WARNING_LEVELS.map((w) => (
                          <SelectItem key={w.value} value={w.value}>
                            {w.labelKey ? t(w.labelKey) : w.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-extra-args">
                      {t("settings.extraArgs")}
                    </Label>
                    <Input
                      id="set-extra-args"
                      type="text"
                      placeholder="-DDEBUG -g"
                      value={draft.compiler.extra_args}
                      onChange={(e) =>
                        updateCompiler("extra_args", e.target.value)
                      }
                    />
                  </div>
                  <p className="settings-hint">{t("settings.extraArgsHint")}</p>

                  <h4 className="settings-section-title pt-2">
                    {t("settings.runtime")}
                  </h4>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-compile-timeout">
                      {t("settings.compileTimeout")}
                    </Label>
                    <Input
                      id="set-compile-timeout"
                      type="number"
                      min={1}
                      max={120}
                      className="w-32"
                      value={draft.runtime.compile_timeout_secs}
                      onChange={(e) =>
                        updateRuntime(
                          "compile_timeout_secs",
                          Number(e.target.value)
                        )
                      }
                    />
                  </div>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-run-timeout">
                      {t("settings.runTimeout")}
                    </Label>
                    <Input
                      id="set-run-timeout"
                      type="number"
                      min={1}
                      max={60}
                      className="w-32"
                      value={draft.runtime.run_timeout_secs}
                      onChange={(e) =>
                        updateRuntime(
                          "run_timeout_secs",
                          Number(e.target.value)
                        )
                      }
                    />
                  </div>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-cpu-secs">
                      {t("settings.cpuSecs")}
                    </Label>
                    <Input
                      id="set-cpu-secs"
                      type="number"
                      min={1}
                      max={60}
                      className="w-32"
                      value={draft.runtime.cpu_secs}
                      onChange={(e) =>
                        updateRuntime("cpu_secs", Number(e.target.value))
                      }
                    />
                  </div>

                  <h4 className="settings-section-title pt-2">
                    {t("settings.testSettings")}
                  </h4>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-test-opt-level">
                      {t("settings.testOptLevel")}
                    </Label>
                    <Select
                      value={draft.test.opt_level}
                      onValueChange={(v) => updateTest("opt_level", v)}
                    >
                      <SelectTrigger id="set-test-opt-level">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {OPT_LEVELS.map((s) => (
                          <SelectItem key={s} value={s}>
                            -{s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="settings-hint">{t("settings.testOptLevelHint")}</p>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-fsize-mb">
                      {t("settings.fsizeMb")}
                    </Label>
                    <Input
                      id="set-fsize-mb"
                      type="number"
                      min={1}
                      max={500}
                      className="w-32"
                      value={draft.test.fsize_mb}
                      onChange={(e) =>
                        updateTest("fsize_mb", Number(e.target.value))
                      }
                    />
                  </div>
                  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                    <Label htmlFor="set-test-time-limit">
                      {t("settings.testTimeLimit")}
                    </Label>
                    <Input
                      id="set-test-time-limit"
                      type="number"
                      min={100}
                      max={10000}
                      step={100}
                      className="w-32"
                      value={draft.test.test_time_limit_ms}
                      onChange={(e) =>
                        updateTest(
                          "test_time_limit_ms",
                          Number(e.target.value),
                        )
                      }
                    />
                  </div>
                  <p className="settings-hint">{t("settings.testTimeLimitHint")}</p>

                  <h4 className="settings-section-title pt-2">
                    {t("settings.codeTemplate")}
                  </h4>
                  <Textarea
                    className="font-mono text-xs"
                    rows={8}
                    value={draft.compiler.template}
                    onChange={(e) =>
                      updateCompiler("template", e.target.value)
                    }
                    spellCheck={false}
                  />
                </TabsContent>

                {/* ========== 快捷键只读展示 Tab ========== */}
                <TabsContent value="shortcuts" className="mt-0">
                  <div className="shortcuts-table">
                    <div className="shortcut-row shortcut-header">
                      <div className="shortcut-cell">
                        {t("settings.shortcutCategory")}
                      </div>
                      <div className="shortcut-cell">
                        {t("settings.shortcutAction")}
                      </div>
                      <div className="shortcut-cell shortcut-key">
                        {t("settings.shortcutKey")}
                      </div>
                    </div>
                    {getShortcuts(isMac).map((s, i) => (
                      <div className="shortcut-row" key={i}>
                        <div className="shortcut-cell">
                          {t(SHORTCUT_CATEGORY_KEY[s.category])}
                        </div>
                        <div className="shortcut-cell">{t(s.action)}</div>
                        <div className="shortcut-cell shortcut-key">
                          <kbd>{s.keys}</kbd>
                        </div>
                      </div>
                    ))}
                  </div>
                </TabsContent>
              </div>
            </Tabs>
          </div>
        )}

        {msg && <div className="settings-msg settings-msg-ok">{msg}</div>}
        {errorMsg && (
          <div className="settings-msg settings-msg-err">{errorMsg}</div>
        )}

        <DialogFooter className="px-6 py-3 border-t border-border flex-shrink-0">
          <Button variant="outline" onClick={handleClose} disabled={saving}>
            {t("settings.cancel")}
          </Button>
          <Button
            variant="default"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? "…" : t("settings.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default SettingsPanel;

import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuCheckboxItem,
} from "./ui/dropdown-menu";
import { useI18n } from "../hooks/useI18n";

export interface TitleBarProps {
  menuHandlers: Record<string, (val?: string) => void>;
  layout: string;
  autoHide: boolean;
}

type TopMenu = "file" | "edit" | "view" | "help";

function Shortcut({ children }: { children: React.ReactNode }) {
  return <kbd className="menu-shortcut">{children}</kbd>;
}

function TitleBar({ menuHandlers, layout, autoHide }: TitleBarProps) {
  const t = useI18n((s) => s.t);
  const [openMenu, setOpenMenu] = useState<TopMenu | null>(null);

  return (
    <div className="titlebar">
      <div className="titlebar-menus">
        {/* 文件菜单 */}
        <DropdownMenu
          modal={false}
          open={openMenu === "file"}
          onOpenChange={(open) => {
            setOpenMenu((current) => {
              if (open) return "file";
              return current === "file" ? null : current;
            });
          }}
        >
          <DropdownMenuTrigger asChild>
            <button className="titlebar-menu-trigger" type="button">
              {t("menu.file")}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="titlebar-menu-content">
            <DropdownMenuItem onClick={() => menuHandlers["file_new"]()}>
              {t("menu.new")}<Shortcut>Ctrl+N</Shortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => menuHandlers["file_open"]()}>
              {t("menu.open")}<Shortcut>Ctrl+O</Shortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => menuHandlers["file_save"]()}>
              {t("menu.save")}<Shortcut>Ctrl+S</Shortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => menuHandlers["file_save_as"]()}>
              {t("menu.saveAs")}<Shortcut>Ctrl+Shift+S</Shortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => menuHandlers["file_recent"]()}>
              {t("menu.recent")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => menuHandlers["file_close"]()}>
              {t("menu.close")}<Shortcut>Ctrl+W</Shortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => menuHandlers["file_close_all"]()}>
              {t("menu.closeAll")}<Shortcut>Ctrl+Shift+W</Shortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* 编辑菜单 */}
        <DropdownMenu
          modal={false}
          open={openMenu === "edit"}
          onOpenChange={(open) => {
            setOpenMenu((current) => {
              if (open) return "edit";
              return current === "edit" ? null : current;
            });
          }}
        >
          <DropdownMenuTrigger asChild>
            <button className="titlebar-menu-trigger" type="button">
              {t("menu.edit")}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="titlebar-menu-content">
            <DropdownMenuItem onClick={() => menuHandlers["edit_undo"]()}>
              {t("menu.undo")}<Shortcut>Ctrl+Z</Shortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => menuHandlers["edit_redo"]()}>
              {t("menu.redo")}<Shortcut>Ctrl+Y</Shortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => menuHandlers["edit_cut"]()}>
              {t("menu.cut")}<Shortcut>Ctrl+X</Shortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => menuHandlers["edit_copy"]()}>
              {t("menu.copy")}<Shortcut>Ctrl+C</Shortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => menuHandlers["edit_paste"]()}>
              {t("menu.paste")}<Shortcut>Ctrl+V</Shortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => menuHandlers["edit_select_all"]()}>
              {t("menu.selectAll")}<Shortcut>Ctrl+A</Shortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => menuHandlers["edit_format"]()}>
              {t("menu.format")}<Shortcut>Shift+Alt+F</Shortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => menuHandlers["find"]()}>
              {t("menu.findFind")}<Shortcut>Ctrl+F</Shortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => menuHandlers["find_next"]()}>
              {t("menu.findNext")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => menuHandlers["find_prev"]()}>
              {t("menu.findPrev")}<Shortcut>Ctrl+Shift+G</Shortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => menuHandlers["replace"]()}>
              {t("menu.replace")}<Shortcut>Ctrl+Alt+F</Shortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => menuHandlers["goto_line"]()}>
              {t("menu.gotoLine")}<Shortcut>Ctrl+G</Shortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* 视图菜单 */}
        <DropdownMenu
          modal={false}
          open={openMenu === "view"}
          onOpenChange={(open) => {
            setOpenMenu((current) => {
              if (open) return "view";
              return current === "view" ? null : current;
            });
          }}
        >
          <DropdownMenuTrigger asChild>
            <button className="titlebar-menu-trigger" type="button">
              {t("menu.view")}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="titlebar-menu-content">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>{t("menu.layout")}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={layout}
                  onValueChange={(value) => menuHandlers["set_layout"](value)}
                >
                  <DropdownMenuRadioItem value="horizontal">
                    {t("menu.layoutHorizontal")}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="vertical">
                    {t("menu.layoutVertical")}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={autoHide}
              onCheckedChange={() => menuHandlers["toggle_auto_hide"]()}
            >
              {t("menu.autoHidePanel")}
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => menuHandlers["font_inc"]()}>
              {t("menu.fontInc")}<Shortcut>Ctrl+=</Shortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => menuHandlers["font_dec"]()}>
              {t("menu.fontDec")}<Shortcut>Ctrl+-</Shortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => menuHandlers["font_reset"]()}>
              {t("menu.fontReset")}<Shortcut>Ctrl+0</Shortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => menuHandlers["toggle_panel"]()}>
              {t("menu.togglePanel")}<Shortcut>Ctrl+\</Shortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* 帮助菜单 */}
        <DropdownMenu
          modal={false}
          open={openMenu === "help"}
          onOpenChange={(open) => {
            setOpenMenu((current) => {
              if (open) return "help";
              return current === "help" ? null : current;
            });
          }}
        >
          <DropdownMenuTrigger asChild>
            <button className="titlebar-menu-trigger" type="button">
              {t("menu.help")}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="titlebar-menu-content">
            <DropdownMenuItem onClick={() => menuHandlers["help"]()}>
              {t("menu.helpContent")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => menuHandlers["toggle_devtools"]()}>
              {t("menu.toggleDevtools")}<Shortcut>Ctrl+Shift+I</Shortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => menuHandlers["settings"]()}>
              {t("menu.settings")}<Shortcut>Ctrl+,</Shortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => menuHandlers["about"]()}>
              {t("menu.about")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="titlebar-title">
        RunCode
      </div>
    </div>
  );
}

export default TitleBar;

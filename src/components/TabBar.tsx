import { X, Plus, Circle } from "lucide-react";
import { useI18n } from "../hooks/useI18n";
import type { Tab } from "../types";

interface TabBarProps {
  tabs: Tab[];
  activeId: string | null;
  onSwitch: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}

function TabBar({ tabs, activeId, onSwitch, onClose, onNew }: TabBarProps) {
  const t = useI18n((s) => s.t);
  return (
    <div className="tab-bar">
      <div className="tab-list">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={"tab-item" + (tab.id === activeId ? " active" : "")}
            onClick={() => onSwitch(tab.id)}
            title={tab.path ?? tab.fileName}
          >
            <span className="tab-name">{tab.fileName}</span>
            {tab.dirty && <Circle size={8} fill="currentColor" stroke="none" className="tab-dirty" />}
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
              title={t("tabs.close")}
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      <button className="tab-new" onClick={onNew} title={t("tabs.new")}>
        <Plus size={14} />
      </button>
    </div>
  );
}

export default TabBar;

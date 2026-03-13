import { useState } from "react";
import { TabBar } from "./components/TabBar";
import { MainView } from "./components/MainView";
import { ConversationOverlay } from "./components/ConversationOverlay";

export type TabId = "files" | "changes" | string;

export function App() {
    const [activeTab, setActiveTab] = useState<TabId>("files");

    return (
        <div className="app">
            <MainView activeTab={activeTab} />

            <ConversationOverlay />

            <TabBar
                activeTab={activeTab}
                onTabChange={setActiveTab}
            />
        </div>
    );
}

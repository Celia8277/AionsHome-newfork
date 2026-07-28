import {
  ArrowLeft,
  Check,
  ChevronRight,
  Edit2,
  FilePlus2,
  Loader2,
  Pin,
  Power,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { LLMAdapter, UplinkSettings } from "../types";
import type { PersonaProfile } from "../storage/personaProfile";
import { upsertMemoryEntry } from "../storage/memoryBank";
import { MarkdownText } from "./MarkdownText";
import {
  addChronicle,
  getChroniclePreferences,
  getContinuityLine,
  listChronicles,
  listMemorySeeds,
  removeChronicle,
  resolveMemorySeed,
  saveChroniclePreferences,
  saveContinuityLine,
  subscribeChronicles,
  updateChronicle,
  type ChronicleEntry,
  type MemorySeed,
} from "../storage/chronicles";
import {
  generateContinuityFromChronicles,
  generateMemorySeeds,
  recentChronicles,
  writeConversationChronicle,
} from "../services/chronicleService";
import { listConversations } from "../storage/conversations";
import { ChronicleBookGlyph, CottageDivider, CottageStar } from "./CottageGlyphs";

interface TimeCorridorPageProps {
  settings: UplinkSettings;
  personaProfile: PersonaProfile;
  llm: LLMAdapter;
}

type PageView = "months" | "entries" | "diary";

function ContinuityVineGlyph({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M7 13 C7 10.5 7 7.5 8.5 5 C9.2 3.8 10.5 3.2 11.5 2.5"
        fill="none"
        stroke="var(--interactive-accent, var(--kx-primary, #dcbda8))"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <path
        d="M6 8 C4.5 7 2.5 7 1.5 7.5 C1 7.7 1.5 9 2.5 9.7 C3.5 10.5 5.2 10.5 6 9.5"
        fill="var(--text-accent, var(--kx-secondary, #a694bc))"
      />
      <path
        d="M8 5.5 C9.5 4.5 11.5 4.5 12.5 5 C13 5.2 12.5 6.5 11.5 7.2 C10.5 8 8.8 8 8 7"
        fill="var(--interactive-accent, var(--kx-primary, #dcbda8))"
      />
      <circle cx="11.5" cy="2.5" r="1.1" fill="#fff" />
    </svg>
  );
}

function RefineStarGlyph({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden="true" className="chronicle-refine-glyph">
      <path
        d="M7 1.5 L8.8 5.2 L12.5 7 L8.8 8.8 L7 12.5 L5.2 8.8 L1.5 7 L5.2 5.2 Z"
        fill="none"
        stroke="var(--interactive-accent, var(--kx-primary, #dcbda8))"
        strokeWidth="0.9"
      />
      <circle cx="7" cy="7" r="1.3" fill="var(--interactive-accent, var(--kx-primary, #dcbda8))" />
    </svg>
  );
}

function DiaryLetterGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect
        x="2.5"
        y="6.5"
        width="9"
        height="6"
        rx="0.5"
        stroke="var(--interactive-accent, var(--kx-primary, #dcbda8))"
        strokeWidth="0.8"
        fill="none"
      />
      <path
        d="M2.5 6.5 L7 9.5 L11.5 6.5"
        stroke="var(--interactive-accent, var(--kx-primary, #dcbda8))"
        strokeWidth="0.75"
        fill="none"
      />
      <line
        x1="9"
        y1="2"
        x2="5"
        y2="10"
        stroke="var(--text-accent, var(--kx-secondary, #a694bc))"
        strokeWidth="0.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

function monthKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string): string {
  const month = Number(key.split("-")[1]);
  const monthNames = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];
  return monthNames[month - 1] || `${month}月`;
}

function dateLabel(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

function fullDateLabel(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function excerpt(text: string, max = 150): string {
  const clean = text.replace(/[#*_>`~\[\]]/g, "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

function shortenText(text: string, max = 26): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function cleanInlineText(text: string): string {
  return String(text || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/[#*_>`~\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTitleCandidate(text: string): string {
  return cleanInlineText(text)
    .replace(/^自动回退摘要[:：]?\s*/i, "")
    .replace(/^(Assistant|User|用户|我)[:：]\s*/i, "")
    .replace(/^(title|标题|content|正文|summary|摘要)[:：]\s*/i, "")
    .replace(/^日期[:：].*$/i, "")
    .replace(/^记录者[:：].*$/i, "")
    .replace(/^在场者[:：].*$/i, "")
    .trim();
}

const CHRONICLE_TEMPLATE_LABEL_PATTERN = /(chronicleentry|diaryentry|memorycorridor|chronicles?|diary|时光回廊|日记)/g;

function isDateOnlyChronicleHeading(value: string): boolean {
  return /^(?:\d{4}(?:年)?\d{1,2}(?:月)?\d{1,2}(?:日)?|\d{4}(?:年)?\d{1,2}(?:月)?|\d{1,2}(?:月)\d{1,2}(?:日)?)$/u.test(value);
}

function isChronicleTemplateHeading(text: string): boolean {
  const value = normalizeTitleCandidate(text);
  const compact = value
    .toLowerCase()
    .replace(/[\s·:：|｜\-—–_=📓📜✨⭐*#"'“”‘’()[\]{}<>「」『』.,，。]+/g, "");
  if (!compact) return true;
  if (isDateOnlyChronicleHeading(compact)) return true;
  const labels = compact.match(CHRONICLE_TEMPLATE_LABEL_PATTERN) || [];
  if (!labels.length) return false;
  const remainder = compact.replace(CHRONICLE_TEMPLATE_LABEL_PATTERN, "");
  return !remainder || isDateOnlyChronicleHeading(remainder);
}

function isMeaningfulTitleCandidate(text?: string): boolean {
  const value = normalizeTitleCandidate(String(text || ""));
  if (!value) return false;
  if (/^[-—–_=]{2,}$/.test(value)) return false;
  if (isChronicleTemplateHeading(value)) return false;
  if (/^(json|jason|markdown)$/i.test(value)) return false;
  if (/^[{}[\],:："'\s]+$/.test(value)) return false;
  if (/^tags?[:：]/i.test(value) || /^情感|氛围|关键词/.test(value)) return false;
  const semantic = value.replace(/#[\w\u4e00-\u9fa5-]+/g, " ").replace(/[^\w\u4e00-\u9fa5]+/g, "").trim();
  return semantic.length >= 2;
}

function isArchiveLikeTitle(title?: string): boolean {
  const value = String(title || "").trim();
  if (!value) return false;
  if (!isMeaningfulTitleCandidate(value)) return true;
  return /^\[(自动总结|手动写入|手写|导入|自动|总结)/.test(value)
    || /\d+\s*轮/.test(value);
}

function deriveContentTitle(content: string): string {
  const lines = String(content || "")
    .split(/\n+/)
    .map((line) => normalizeTitleCandidate(line))
    .filter(isMeaningfulTitleCandidate);
  const first = lines.find((line) => !/^tags?[:：]/i.test(line) && !/^情感|氛围|关键词/.test(line));
  const firstSentence = first?.split(/[。！？!?；;]/)[0]?.trim();
  return firstSentence && isMeaningfulTitleCandidate(firstSentence) ? shortenText(firstSentence, 24) : "";
}

function getChronicleTitleView(entry: ChronicleEntry) {
  const rawTitle = entry.title || "";
  const bracketParts = Array.from(rawTitle.matchAll(/\[([^\]]+)\]/g)).map((match) => match[1].trim()).filter(Boolean);
  const typePart = bracketParts.find((part) => /自动|手写|手动|总结|导入/.test(part));
  const windowPart = bracketParts.find((part) => !/自动|手写|手动|总结|导入/.test(part)) || entry.sessionTitle || "";
  const manualPage = rawTitle.match(/第[「『]([^」』]+)[」』]页/);
  const isManual = /手写|手动/.test(`${typePart || ""} ${rawTitle}`)
    || (entry.triggerKeywords || []).some((keyword) => /手写|manual|hand/i.test(keyword));
  const typeChip = isManual ? "手动" : "自动";
  const diaryTitle = !isArchiveLikeTitle(entry.diaryTitle) ? String(entry.diaryTitle || "").trim() : "";
  const strippedTitle = cleanInlineText(
    rawTitle
      .replace(/\[[^\]]+\]/g, " ")
      .replace(/手写日记/g, " ")
      .replace(/\d{4}[-年]\d{1,2}(?:[-月]\d{1,2})?日?/g, " ")
      .replace(/\d+\s*轮/g, " ")
      .replace(/[·・]/g, " "),
  );

  const displayTitle =
    diaryTitle
    || manualPage?.[1]
    || deriveContentTitle(entry.content || "")
    || (isMeaningfulTitleCandidate(strippedTitle) ? strippedTitle : "")
    || windowPart
    || (isMeaningfulTitleCandidate(rawTitle) ? rawTitle : "")
    || "未命名日记";
  const chips = [typeChip, windowPart].filter((chip): chip is string => Boolean(chip));
  return {
    displayTitle: shortenText(displayTitle, 26),
    chips: Array.from(new Set(chips)).slice(0, 2),
  };
}

function toneForIndex(index: number): string {
  return ["paper", "mist", "lavender", "paper", "deep"][index % 5];
}

const DIARY_TONE_ORDER = ["paper", "deep", "mist", "lavender"] as const;

function diaryToneForIndex(index: number): string {
  return DIARY_TONE_ORDER[index % DIARY_TONE_ORDER.length];
}

export function TimeCorridorPage({ settings, personaProfile, llm }: TimeCorridorPageProps) {
  const [entries, setEntries] = useState(() => listChronicles());
  const [view, setView] = useState<PageView>("months");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [activeDiaryId, setActiveDiaryId] = useState("");
  const [query, setQuery] = useState("");
  const [editingEntry, setEditingEntry] = useState<ChronicleEntry | null>(null);
  const [showComposer, setShowComposer] = useState(false);
  const [showContinuity, setShowContinuity] = useState(false);
  const [showSeeds, setShowSeeds] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [preferences, setPreferences] = useState(() => getChroniclePreferences());
  const [continuityLine, setContinuityLine] = useState(() => getContinuityLine());
  const [seeds, setSeeds] = useState(() => listMemorySeeds());

  useEffect(() => subscribeChronicles(() => {
    setEntries(listChronicles());
    setPreferences(getChroniclePreferences());
    setContinuityLine(getContinuityLine());
    setSeeds(listMemorySeeds());
  }), []);

  const groupedMonths = useMemo(() => {
    const groups = new Map<string, ChronicleEntry[]>();
    entries.forEach((entry) => groups.set(monthKey(entry.createdAt), [...(groups.get(monthKey(entry.createdAt)) || []), entry]));
    return [...groups.entries()].sort(([left], [right]) => right.localeCompare(left));
  }, [entries]);

  const monthEntries = useMemo(() => entries
    .filter((entry) => monthKey(entry.createdAt) === selectedMonth)
    .filter((entry) => {
      const needle = query.trim().toLowerCase();
      return !needle || `${entry.title} ${entry.content} ${entry.triggerKeywords.join(" ")}`.toLowerCase().includes(needle);
    }), [entries, query, selectedMonth]);

  const activeDiary = entries.find((entry) => entry.id === activeDiaryId) || null;
  const activeDiaryTitleView = activeDiary ? getChronicleTitleView(activeDiary) : null;
  const activePersona = personaProfile.personas.find((persona) => persona.id === personaProfile.activePersonaId) || personaProfile.personas[0];
  const [selectedYearLabel = "", selectedMonthLabel = ""] = selectedMonth.split("-");

  function openMonth(key: string) {
    setSelectedMonth(key);
    setQuery("");
    setView("entries");
  }

  function openDiary(id: string) {
    setActiveDiaryId(id);
    setView("diary");
  }

  function deleteEntry(entry: ChronicleEntry) {
    if (!window.confirm(`确定删除「${getChronicleTitleView(entry).displayTitle}」吗？`)) return;
    removeChronicle(entry.id);
    if (activeDiaryId === entry.id) setView("entries");
  }

  function deleteMonth(key: string) {
    const rows = entries.filter((entry) => monthKey(entry.createdAt) === key);
    if (!window.confirm(`确定删除 ${monthLabel(key)} 的 ${rows.length} 篇日记吗？`)) return;
    rows.forEach((entry) => removeChronicle(entry.id));
  }

  async function generateLatestDiary() {
    const conversation = listConversations()[0];
    if (!conversation) { setNotice("还没有可整理的对话窗口。"); return; }
    setBusy("diary");
    setNotice("");
    try {
      const entry = await writeConversationChronicle(llm, personaProfile, conversation, "manual");
      setNotice(entry ? `已写入「${getChronicleTitleView(entry).displayTitle}」。` : "当前对话内容还不足以写成日记。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "日记生成失败。");
    } finally {
      setBusy("");
    }
  }

  async function refineMemories() {
    const source = selectedMonth ? entries.filter((entry) => monthKey(entry.createdAt) === selectedMonth) : entries.slice(0, 30);
    if (!source.length) { setNotice("这个范围还没有日记可以提炼。"); return; }
    setBusy("seeds");
    try {
      await generateMemorySeeds(llm, personaProfile, source);
      setSeeds(listMemorySeeds());
      setShowSeeds(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "回忆提炼失败。");
    } finally {
      setBusy("");
    }
  }

  async function refineContinuity() {
    const source = recentChronicles(preferences.recentDays);
    if (!source.length) { setNotice(`最近 ${preferences.recentDays} 天还没有日记。`); return; }
    setBusy("continuity");
    try {
      await generateContinuityFromChronicles(llm, personaProfile, source, preferences.recentDays);
      setContinuityLine(getContinuityLine());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "生活线提炼失败。");
    } finally {
      setBusy("");
    }
  }

  function storeSeed(seed: MemorySeed) {
    const now = new Date().toISOString();
    upsertMemoryEntry({
      id: `memory-seed:${seed.id}`,
      title: seed.title,
      content: seed.content,
      tags: [...new Set([...seed.tags, "回忆种子"])],
      aliases: [],
      importance: seed.importance,
      createdAt: now,
      updatedAt: now,
      sourceType: "chronicle_seed",
      sourceId: seed.sourceChronicleIds[0],
      sourceTitle: seed.title,
    });
    resolveMemorySeed(seed.id, "stored");
    setSeeds(listMemorySeeds());
  }

  return (
    <main className="cinema-shell chronicle-route-shell" data-theme={settings.visual.theme} data-font={settings.visual.fontStyle} data-font-size={settings.visual.fontSize}>
      <section className="chronicle-page">
        {view === "months" ? (
          <>
            <header className="chronicle-page-header">
              <div className="chronicle-title-lockup"><ChronicleBookGlyph /><div><span className="chronicle-page-kicker">CHRONICLES</span><h1>时光回廊</h1><p>把日记、生活线和回忆种子留在这里，需要时再慢慢翻回。</p></div></div>
              <div className="chronicle-toolbar">
                <button type="button" className="chronicle-continuity-button" onClick={() => setShowContinuity(true)}><ContinuityVineGlyph size={15} />跨窗接续</button>
                <button type="button" onClick={() => setShowComposer(true)}><FilePlus2 size={15} />手写</button>
              </div>
            </header>
            <CottageDivider />
            <div className="chronicle-month-list">
              {groupedMonths.map(([key, rows], index) => {
                const tone = toneForIndex(index);
                const latest = rows[0];
                const latestTitle = getChronicleTitleView(latest);
                return (
                  <article key={key} className={`chronicle-month-card tone-${tone}`} onClick={() => openMonth(key)}>
                    <span className="chronicle-month-edge" />
                    <div className="chronicle-month-number">{key.slice(5)}</div>
                    <div className="chronicle-month-copy"><h2>{monthLabel(key)}</h2><span>{key.slice(0, 4)} · MEMORY BOOK</span><p>{latestTitle.displayTitle}</p></div>
                    <div className="chronicle-month-meta"><span>{rows.length} 篇</span><ChevronRight size={17} /></div>
                    <button type="button" className="chronicle-delete-month" title="删除整月" onClick={(event) => { event.stopPropagation(); deleteMonth(key); }}><Trash2 size={14} /></button>
                  </article>
                );
              })}
              {!groupedMonths.length ? <div className="chronicle-empty"><ChronicleBookGlyph /><strong>还没有日记</strong><p>可以手写一篇，或从最近的对话生成。</p><button type="button" onClick={generateLatestDiary} disabled={busy === "diary"}>{busy === "diary" ? <Loader2 className="chronicle-spin" size={15} /> : <Sparkles size={15} />}从最近对话生成</button></div> : null}
            </div>
          </>
        ) : null}

        {view === "entries" ? (
          <>
            <header className="chronicle-list-header">
              <button className="chronicle-back" type="button" onClick={() => setView("months")} aria-label="返回时光回廊"><ArrowLeft size={22} /></button>
              <div>
                <h1 className="chronicle-volume-title">
                  <span className="chronicle-volume-title-number">{selectedYearLabel}</span>
                  <span className="chronicle-volume-title-mark">年</span>
                  <span className="chronicle-volume-title-number">{selectedMonthLabel}</span>
                  <span className="chronicle-volume-title-mark">月</span>
                </h1>
                <p>{monthEntries.length} 篇日记</p>
              </div>
            </header>
            <CottageDivider />
            <div className="chronicle-search-row">
              <label><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="在此卷中检索..." /></label>
              <button type="button" onClick={refineMemories} disabled={busy === "seeds"}>{busy === "seeds" ? <Loader2 className="chronicle-spin" size={15} /> : <RefineStarGlyph size={15} />}提炼回忆</button>
            </div>
            <div className="chronicle-entry-list">
              {monthEntries.map((entry, index) => {
                const titleView = getChronicleTitleView(entry);
                return (
                  <article key={entry.id} className={`chronicle-entry tone-${diaryToneForIndex(index)} ${entry.isActive ? "" : "inactive"}`}>
                    <div className="chronicle-entry-rail">
                      <button type="button" className={entry.starred ? "starred" : ""} onClick={() => updateChronicle(entry.id, { starred: !entry.starred })} aria-label={entry.starred ? "取消星标" : "标记星星"}>{entry.starred ? <CottageStar /> : <i />}</button>
                      <span />
                    </div>
                    <div className="chronicle-entry-main" onClick={() => openDiary(entry.id)}>
                      <div className="chronicle-entry-head"><span className="chronicle-entry-date">{dateLabel(entry.createdAt)}</span><div className="chronicle-entry-actions">
                        <button type="button" title={entry.isActive ? "从召回中卸载" : "重新载入召回"} onClick={(event) => { event.stopPropagation(); updateChronicle(entry.id, { isActive: !entry.isActive }); }}><Power size={15} /></button>
                        <button type="button" title="编辑" onClick={(event) => { event.stopPropagation(); setEditingEntry(entry); }}><Edit2 size={15} /></button>
                        <button type="button" title="删除" onClick={(event) => { event.stopPropagation(); deleteEntry(entry); }}><Trash2 size={15} /></button>
                        <ChevronRight size={16} />
                      </div></div>
                      <div className="chronicle-entry-card">
                        <h2>{titleView.displayTitle}</h2>
                        <div className="chronicle-entry-badges">{titleView.chips.map((chip) => <span key={chip}>{chip}</span>)}</div>
                        <p>{excerpt(entry.content, 180)}</p>
                        <div className="chronicle-entry-tags">{entry.triggerKeywords.slice(0, 5).map((tag) => <span key={tag}>#{tag}</span>)}</div>
                      </div>
                    </div>
                  </article>
                );
              })}
              {!monthEntries.length ? <div className="chronicle-empty compact"><p>没有找到匹配的日记。</p></div> : null}
            </div>
          </>
        ) : null}

        {view === "diary" && activeDiary ? (
          <article className="chronicle-reading-page">
            <header className="chronicle-reading-header">
              <button type="button" onClick={() => setView("entries")} aria-label="返回日记列表"><ArrowLeft size={23} /></button>
              <div className="chronicle-reading-date"><strong>{String(new Date(activeDiary.createdAt).getDate()).padStart(2, "0")}</strong><span>{fullDateLabel(activeDiary.createdAt)}</span></div>
              <div className="chronicle-reading-heading"><span>日记 / DIARY</span><h1>{activeDiaryTitleView?.displayTitle || "未命名日记"}</h1><p>{activeDiaryTitleView?.chips.join(" · ") || (activeDiary.mode === "auto" ? "自动整理" : "手动记录")}</p></div>
            </header>
            <CottageDivider />
            <div className="chronicle-reading-sheet">
              <CottageStar className="chronicle-reading-star top" />
              <MarkdownText text={activeDiary.content} className="chronicle-reading-body" />
              {activeDiary.facts[0] ? <blockquote>{activeDiary.facts[0]}</blockquote> : null}
              <footer><span>—— {activeDiary.personaName || activePersona?.name || "Persona"}</span><small>MEMORY CORRIDOR</small></footer>
              <CottageStar className="chronicle-reading-star bottom" />
            </div>
            <div className="chronicle-reading-actions"><button type="button" onClick={() => setEditingEntry(activeDiary)}><Edit2 size={15} />编辑</button><button type="button" onClick={() => deleteEntry(activeDiary)}><Trash2 size={15} />删除</button></div>
          </article>
        ) : null}

        {notice ? <button type="button" className="chronicle-notice" onClick={() => setNotice("")}>{notice}<X size={14} /></button> : null}
      </section>

      {(showComposer || editingEntry) ? <DiaryEditor entry={editingEntry} onClose={() => { setShowComposer(false); setEditingEntry(null); }} /> : null}
      {showContinuity ? <ContinuityDialog preferences={preferences} line={continuityLine} busy={busy} onClose={() => setShowContinuity(false)} onPreferences={(patch: Partial<typeof preferences>) => setPreferences(saveChroniclePreferences(patch))} onGenerate={refineContinuity} onLineChange={(content: string) => setContinuityLine(saveContinuityLine({ content }))} /> : null}
      {showSeeds ? <SeedDialog seeds={seeds} onClose={() => setShowSeeds(false)} onStore={storeSeed} onIgnore={(seed) => { resolveMemorySeed(seed.id, "ignored"); setSeeds(listMemorySeeds()); }} /> : null}
    </main>
  );
}

function DiaryEditor({ entry, onClose }: { entry: ChronicleEntry | null; onClose: () => void }) {
  const [title, setTitle] = useState(entry ? getChronicleTitleView(entry).displayTitle : "");
  const [content, setContent] = useState(entry?.content || "");
  const [tags, setTags] = useState(entry?.triggerKeywords.join("，") || "");
  function save() {
    if (!content.trim()) return;
    const parsedTags = tags.split(/[,，\s]+/).map((tag) => tag.trim()).filter(Boolean).slice(0, 8);
    if (entry) updateChronicle(entry.id, { title: title.trim() || "未命名日记", diaryTitle: title.trim() || undefined, content: content.trim(), triggerKeywords: parsedTags });
    else addChronicle({ title: title.trim() || "今日小记", diaryTitle: title.trim() || undefined, content: content.trim(), dateRange: new Date().toLocaleDateString(), createdAt: Date.now(), isActive: true, starred: false, mode: "manual", triggerKeywords: parsedTags, facts: [] });
    onClose();
  }
  return (
    <div className="chronicle-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="chronicle-modal diary-editor">
        <button className="chronicle-modal-close" onClick={onClose} aria-label="关闭日记编辑"><X size={18} /></button>
        <header className="diary-editor-head">
          <span className="diary-editor-glyph"><DiaryLetterGlyph /></span>
          <div>
            <h2>{entry ? "编辑日记" : "手写日记"}</h2>
            <p>把今天值得留下的片段，写成之后也能自然翻回的一页。</p>
          </div>
        </header>
        <div className="diary-editor-divider" aria-hidden="true">
          <span />
          <CottageStar />
          <span />
        </div>
        <div className="diary-editor-fields">
          <label className="diary-editor-title-field">标题<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="给这一天一个自然的标题" /></label>
          <label>标签<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="用逗号分隔" /></label>
          <label className="diary-editor-body-field">正文<textarea value={content} onChange={(event) => setContent(event.target.value)} rows={12} placeholder="今天发生了什么..." /></label>
        </div>
        <footer className="diary-editor-foot">
          <span>手写内容会进入时光回廊，可在召回时作为长期连续性的素材。</span>
          <button className="chronicle-primary diary-save-button" onClick={save}><Check size={16} />保存日记</button>
        </footer>
      </div>
    </div>
  );
}

function ContinuityDialog({ preferences, line, busy, onClose, onPreferences, onGenerate, onLineChange }: any) {
  const [pin, setPin] = useState("");
  const pendingSeedCount = listMemorySeeds().filter((seed) => seed.status === "pending").length;
  return (
    <div className="chronicle-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="chronicle-modal continuity-dialog">
        <button className="chronicle-modal-close" onClick={onClose} aria-label="关闭跨窗接续"><X size={16} /></button>
        <header className="continuity-dialog-head">
          <span className="continuity-dialog-glyph"><CottageStar /></span>
          <div>
            <h2>跨窗接续</h2>
            <p>生活线负责最近没断，召回负责相关旧事想起来。</p>
          </div>
        </header>

        <div className="continuity-option-grid">
          <label className={`chronicle-check continuity-option ${preferences.includeContinuityLine ? "active" : ""}`}>
            <input type="checkbox" checked={preferences.includeContinuityLine} onChange={(event) => onPreferences({ includeContinuityLine: event.target.checked })} />
            <span><strong>带上近期生活线</strong><small>知道最近几天发生了什么，不需要主动复述。</small></span>
          </label>
          <label className={`chronicle-check continuity-option ${preferences.enableMemoryRecall ? "active soft" : ""}`}>
            <input type="checkbox" checked={preferences.enableMemoryRecall} onChange={(event) => onPreferences({ enableMemoryRecall: event.target.checked })} />
            <span><strong>启用记忆召回</strong><small>聊到相关的事，会从日记、记忆库和外脑里想起来。</small></span>
          </label>
        </div>

        <section className="continuity-range-card">
          <div className="continuity-range-head">
            <strong>近期范围</strong>
            <div className="chronicle-days">{[3, 7, 14].map((days) => <button key={days} className={preferences.recentDays === days ? "active" : ""} onClick={() => onPreferences({ recentDays: days })}>{days} 天</button>)}</div>
          </div>
          <label className="continuity-line-field">
            <span className="continuity-line-head">
              <strong>当前生活线</strong>
              {line.updatedAt ? <em>{new Date(line.updatedAt).toLocaleString()}</em> : null}
            </span>
            <textarea value={line.content} onChange={(event) => onLineChange(event.target.value)} rows={5} placeholder="还没有生活线，可以从近期日记提炼。" />
          </label>
          <button className="chronicle-primary continuity-generate" onClick={onGenerate} disabled={busy === "continuity"}>
            {busy === "continuity" ? <Loader2 className="chronicle-spin" size={15} /> : <RefineStarGlyph size={15} />}
            提炼生活线
          </button>
        </section>

        <section className="chronicle-auto-settings">
          <div><strong>日记整理</strong><small>手动指令始终可用，自动整理按对话轮次触发。</small></div>
          <label className="chronicle-check compact"><input type="checkbox" checked={preferences.autoEnabled} onChange={(event) => onPreferences({ autoEnabled: event.target.checked })} /><span><strong>自动日记</strong><small>达到设定轮次后写入时光回廊。</small></span></label>
          <label className="chronicle-frequency"><span>每</span><input type="number" min="5" max="100" value={preferences.summaryFrequency} onChange={(event) => onPreferences({ summaryFrequency: Number(event.target.value) || 20 })} /><span>轮整理一次</span></label>
        </section>

        <div className="chronicle-pins">
          <strong><Pin size={13} />置顶事项</strong>
          {line.pinned.map((item: any) => <div key={item.id}><span>{item.content}</span><button onClick={() => saveContinuityLine({ pinned: line.pinned.filter((row: any) => row.id !== item.id) })} aria-label="取消置顶"><X size={12} /></button></div>)}
          {line.pinned.length < 3 ? (
            <form onSubmit={(event) => { event.preventDefault(); if (!pin.trim()) return; saveContinuityLine({ pinned: [...line.pinned, { id: `pin-${Date.now()}`, content: pin.trim(), createdAt: Date.now() }] }); setPin(""); }}>
              <input value={pin} onChange={(event) => setPin(event.target.value)} placeholder="最多置顶三件仍未结束的事" />
              <button><Pin size={13} /></button>
            </form>
          ) : null}
        </div>

        <div className="continuity-seed-foot">
          <span>待确认回忆种子</span>
          <strong>{pendingSeedCount}</strong>
        </div>
      </div>
    </div>
  );
}

function SeedDialog({ seeds, onClose, onStore, onIgnore }: { seeds: MemorySeed[]; onClose: () => void; onStore: (seed: MemorySeed) => void; onIgnore: (seed: MemorySeed) => void }) {
  return <div className="chronicle-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="chronicle-modal seed-dialog"><button className="chronicle-modal-close" onClick={onClose}><X size={18} /></button><h2>回忆种子</h2><p>这些只是候选，是否长期留下由你决定。</p><div>{seeds.map((seed) => <article key={seed.id}><span>{seed.date}</span><h3>{seed.title}</h3><p>{seed.content}</p><div>{seed.tags.map((tag) => <i key={tag}>#{tag}</i>)}</div><footer><button onClick={() => onIgnore(seed)}>忽略</button><button className="chronicle-primary" onClick={() => onStore(seed)}>存入记忆库</button></footer></article>)}{!seeds.length ? <div className="chronicle-empty compact"><p>暂时没有待确认的回忆种子。</p></div> : null}</div></div></div>;
}


"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

const BRAND = {
  name: "European Capital Partners",
  logoPath: "/ecp-logo.jpg",
  primary: "#1F2B6E",
  secondary: "#2E6BFF",
  gradientFrom: "#3A8BFF",
  gradientTo: "#1E2A78",
};

const TEMPLATES = [
  {
    id: "pe_memo",
    name: "PE-Style Investment Memo",
    description: "Structured memo (Summary → Market → Company → Thesis → Risks → Valuation → Recommendation).",
    system:
      "You are ChatGPT 5, an elite buy-side analyst. Write in crisp, decision-focused prose. Emphasize unit economics, catalysts, risks, and valuation. Always include a recommendation (Buy/Hold/Sell) with a target price and time horizon. Provide defensible assumptions and cite data sources if given.",
    user:
      `Create a PE-style investment memo for {company} ({ticker}) in the {sector} sector.\nFocus: {focus}.\nConstraints: {constraints}.\nInvestor profile: {investorProfile}.\nRegion: {region}, Currency: {currency}.\nIf no hard data is supplied, propose reasonable ranges and clearly label them as illustrative. Include scenarios (bear/base/bull) and a concise risk matrix.`,
  },
  {
    id: "one_pager",
    name: "One-Pager",
    description: "One page executive summary with bullets and a small table.",
    system:
      "You are ChatGPT 5, an equity analyst. Deliver a single-page summary with bullet points, a mini table for valuation, and 3 catalysts + 3 risks. Keep it skimmable.",
    user:
      `Produce a one-page investment summary for {company} ({ticker}). Sector: {sector}.\nKey angle: {focus}.\nInvestor profile: {investorProfile}.\nInclude a compact valuation snapshot and 3-point action plan.`,
  },
  {
    id: "swot",
    name: "SWOT + 5 Forces",
    description: "SWOT grid + Porter analysis + quick valuation note.",
    system:
      "You are ChatGPT 5, a strategy consultant. Be structured and concise. Include SWOT, Porter Five Forces, and a short valuation viewpoint.",
    user:
      `Create a SWOT and Porter Five Forces analysis for {company} ({ticker}), sector {sector}.\nAngle: {focus}.\nConclude with valuation stance, key risks, and near-term catalysts.`,
  },
  {
    id: "dcf_outline",
    name: "DCF Outline",
    description: "Assumption grid + steps to build a simple DCF.",
    system:
      "You are ChatGPT 5, a valuation specialist. Lay out a clean DCF framework with explicit assumptions and sensitivities.",
    user:
      `Draft a DCF framework for {company} ({ticker}).\nSector: {sector}.\nHighlight revenue drivers, margin path, capex, WC, WACC logic, terminal value choice. Provide a sensitivity table description.`,
  },
];

const DEFAULT_SECTIONS = [
  "Executive Summary",
  "Business Overview",
  "Market & Competition",
  "Investment Thesis",
  "Catalysts",
  "Risks & Mitigations",
  "Valuation & Scenarios",
  "Conclusion & Recommendation",
];

const DEFAULT_MODEL = "gpt-5.1";

export default function Page() {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [templateId, setTemplateId] = useState(TEMPLATES[0].id);
  const [company, setCompany] = useState("");
  const [ticker, setTicker] = useState("");
  const [sector, setSector] = useState("");
  const [focus, setFocus] = useState("Growth vs. profitability trade-off");
  const [constraints, setConstraints] = useState("Max 2 pages, cite only provided sources");
  const [investorProfile, setInvestorProfile] = useState("Long-only, moderate risk, 3-year horizon");
  const [region, setRegion] = useState("Europe");
  const [currency, setCurrency] = useState("EUR");
  const [customSections, setCustomSections] = useState<string[]>(DEFAULT_SECTIONS);
  const [includeAppendix, setIncludeAppendix] = useState(true);
  const [temperature, setTemperature] = useState(0.3);
  const [isGenerating, setIsGenerating] = useState(false);
  const [chat, setChat] = useState<{role: string, content: string}[]>([]);
  const [draft, setDraft] = useState<string>("\n> Your investment memo will appear here.\n\nStart by filling the company details on the left, choose a template, and click **Generate Draft**. Then iterate via chat and export to PDF.\n");
  const [error, setError] = useState<string>("");
  const [showSettings, setShowSettings] = useState(false);
  const draftRef = useRef<HTMLDivElement | null>(null);
  
// Company logo (PNG/JPG). Prefer upload; URL is best-effort.
  const [companyLogoData, setCompanyLogoData] = useState<string | null>(null); // data URL
  const [companyLogoUrl, setCompanyLogoUrl] = useState("");

// Upload handler -> store as data URL (no CORS problems)
function onCompanyLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!/image\/(png|jpeg)/i.test(file.type)) {
    setError("Please upload a PNG or JPG logo.");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => setCompanyLogoData(reader.result as string);
  reader.readAsDataURL(file);
}

// Try to fetch logo from URL -> data URL (may fail if remote blocks CORS)
async function loadLogoFromUrl() {
  if (!companyLogoUrl) return;
  try {
    const res = await fetch(companyLogoUrl, { mode: "cors" });
    if (!res.ok) throw new Error("Logo URL not reachable.");
    const blob = await res.blob();
    if (!/image\/(png|jpeg)/i.test(blob.type)) throw new Error("Logo must be PNG or JPG.");
    const reader = new FileReader();
    reader.onload = () => setCompanyLogoData(reader.result as string);
    reader.readAsDataURL(blob);
  } catch (err: any) {
    setError(err.message || "Could not load logo from URL. Try uploading a file instead.");
  }
}

  useEffect(() => {
    const savedKey = localStorage.getItem("icstudio_api_key") || "";
    if (savedKey) setApiKey(savedKey);
  }, []);
  useEffect(() => {
    if (apiKey) localStorage.setItem("icstudio_api_key", apiKey);
  }, [apiKey]);

  const template = useMemo(() => TEMPLATES.find(t => t.id === templateId)!, [templateId]);

  const buildUserPrompt = () => {
    return template.user
      .replaceAll("{company}", company || "<Company>")
      .replaceAll("{ticker}", ticker || "<TICKR>")
      .replaceAll("{sector}", sector || "<Sector>")
      .replaceAll("{focus}", focus || "<Focus>")
      .replaceAll("{constraints}", constraints || "<Constraints>")
      .replaceAll("{investorProfile}", investorProfile || "<InvestorProfile>")
      .replaceAll("{region}", region || "<Region>")
      .replaceAll("{currency}", currency || "<CCY>");
  };

  const baseSystemPrompt = useMemo(() => {
    const sectionList = customSections.map((s, i) => `${i + 1}. ${s}`).join("\\n");
    return `${template.system}\\n\\nWhen asked for a memo, structure the output with clear markdown H2s for each section below (only include sections that fit the chosen template):\\n${sectionList}\\n\\nUse tight paragraphs, numbered bullets where helpful, and tables where you present numbers. If data is missing, propose clearly labeled assumptions with ranges and reasoning.`;
  }, [template, customSections]);

  async function callOpenAI(messages: {role: string, content: string}[]) {
    setError("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, temperature, messages }),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      const content = json.choices?.[0]?.message?.content || "";
      return content;
    } catch (e: any) {
      setError(e.message || String(e));
      return null;
    }
  }

  async function generateDraft() {
    if (!apiKey) {
      setShowSettings(true);
      setError("Please paste your OpenAI API key in Settings.");
      return;
    }
    setIsGenerating(true);
    const sys = { role: "system", content: baseSystemPrompt };
    const usr = { role: "user", content: buildUserPrompt() };
    const content = await callOpenAI([sys, usr]);
    if (content) {
      setDraft(content);
      setChat([{ role: "system", content: baseSystemPrompt }, { role: "user", content: usr.content }, { role: "assistant", content }]);
    }
    setIsGenerating(false);
  }

  async function sendFollowUp(message: string) {
    if (!apiKey) {
      setShowSettings(true);
      setError("Please paste your OpenAI API key in Settings.");
      return;
    }
    setIsGenerating(true);
    const newChat = [...chat, { role: "user", content: message }];
    const content = await callOpenAI(newChat.map(({ role, content }) => ({ role, content })));
    if (content) {
      setChat([...newChat, { role: "assistant", content }]);
      setDraft(content);
    }
    setIsGenerating(false);
  }
async function exportPDF() {
  const container = draftRef.current;
  if (!container) return;

  // helper: Title Case company name (e.g., "apple" -> "Apple")
  const toTitleCase = (s: string) =>
    s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

  // ---- jsPDF setup
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth  = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  // ---- Cover (centered), no ChatGPT line
  pdf.setFillColor(31, 43, 110);            // ECP header bar
  pdf.rect(0, 0, pageWidth, 60, "F");
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = "/ecp-logo.jpg";
    await new Promise((r) => { img.onload = r; img.onerror = r; });
    pdf.addImage(img, "JPEG", 36, 14, 90, 32);
  } catch (e) {}
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(16);
  pdf.text("European Capital Partners · Investment Case", 140, 40);

  const titleY   = pageHeight / 2 - 20;
  const companyY = titleY + 34;
  const meta1Y   = companyY + 24;
  const meta2Y   = meta1Y + 18;

  const displayCompany = company ? toTitleCase(company) : "<Company>";
  const templateName   = TEMPLATES.find(t => t.id === templateId)?.name ?? "";

  pdf.setTextColor(0, 0, 0);
  pdf.setFont("helvetica", "bold");  pdf.setFontSize(28);
  pdf.text("Investment Case", pageWidth / 2, titleY, { align: "center" });

  pdf.setFont("helvetica", "normal"); pdf.setFontSize(16);
  pdf.text(displayCompany, pageWidth / 2, companyY, { align: "center" });

  pdf.setFontSize(12);
  pdf.text(`Template: ${templateName}`, pageWidth / 2, meta1Y, { align: "center" });
  pdf.text(`Region: ${region}  •  Currency: ${currency}`, pageWidth / 2, meta2Y, { align: "center" });

  pdf.addPage();

  // ---- CLEAN CLONE for export (no border/rounded, no blockquote bars)
  const clone = container.cloneNode(true) as HTMLElement;

  // remove the outer card styles that create a box/border
  (clone as HTMLElement).style.border = "0";
  (clone as HTMLElement).style.boxShadow = "none";
  (clone as HTMLElement).style.background = "#ffffff";
  (clone as HTMLElement).style.padding = "0";

  // kill blockquote left bars for export only
  clone.querySelectorAll("blockquote").forEach((el) => {
    (el as HTMLElement).style.borderLeft = "0";
    (el as HTMLElement).style.marginLeft = "0";
    (el as HTMLElement).style.paddingLeft = "0";
  });

  // OPTIONAL: strip common AI disclaimers if present
  // (keeps everything else untouched)
  const killDisclaimers = (root: HTMLElement) => {
    const text = root.innerText || "";
    if (/as a (text-)?based ai|as an ai/i.test(text)) {
      // crude but safe: remove the first paragraph if it's a disclaimer
      const p = root.querySelector("p");
      if (p && /as a (text-)?based ai|as an ai/i.test(p.textContent || "")) p.remove();
    }
  };
  killDisclaimers(clone);

  // Put the clone off-screen while rendering
  clone.style.position = "fixed";
  clone.style.left = "-99999px";
  document.body.appendChild(clone);

  // ---- Use jsPDF's HTML renderer (handles pagination → no cut-off)
  // Leave top space if you later want per-page headers; for now start near top
  await pdf.html(clone, {
    x: 48,
    y: 48,
    width: pageWidth - 96,
    html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
  });

  document.body.removeChild(clone);

  // // Optional footer with page numbers (skip cover = page 1)
  // const total = pdf.internal.getNumberOfPages();
  // for (let i = 2; i <= total; i++) {
  //   pdf.setPage(i);
  //   const w = pdf.internal.pageSize.getWidth();
  //   const h = pdf.internal.pageSize.getHeight();
  //   pdf.setFontSize(9);
  //   pdf.text(`${i - 1} / ${total - 1}`, w - 48, h - 24, { align: "right" as any });
  // }

  pdf.save(`${displayCompany.replace(/\s+/g, "_")}_Investment_Case.pdf`);
}

  

  function addSection() { setCustomSections(prev => [...prev, `Custom Section ${prev.length + 1}`]); }
  function updateSection(i: number, val: string) { setCustomSections(prev => prev.map((s, idx) => (idx === i ? val : s))); }
  function removeSection(i: number) { setCustomSections(prev => prev.filter((_, idx) => idx !== i)); }
  function clearAll() {
    setCompany(""); setTicker(""); setSector(""); setFocus(""); setConstraints("");
    setInvestorProfile("Long-only, moderate risk, 3-year horizon"); setRegion("Europe"); setCurrency("EUR");
    setCustomSections(DEFAULT_SECTIONS); setDraft("> Start a new memo by filling details and Generate Draft."); setChat([]);
  }

  return (
    <div className="w-full min-h-screen">
      {/* Header */}
      <div className="sticky top-0 z-30 border-b bg-white/80 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <img src={BRAND.logoPath} className="h-7 w-auto" alt="ECP"/>
          <h1 className="text-xl font-semibold">{BRAND.name} · Investment Case Studio</h1>
          <span className="badge ml-1">ChatGPT-5</span>
          <div className="ml-auto flex items-center gap-2">
            <button className="btn" onClick={() => setShowSettings(s => !s)}>Settings</button>
            <button className="btn btn-primary" onClick={exportPDF}>Export PDF</button>
          </div>
        </div>
        <div className="h-1" style={{background: `linear-gradient(90deg, ${BRAND.gradientFrom}, ${BRAND.gradientTo})`}} />
      </div>

      {/* Main */}
      <div className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left */}
        <div className="lg:col-span-1 space-y-4">
          <div className="card">
            <div className="card-h">
              <div className="text-lg font-semibold">Deal Setup</div>
              <div className="text-sm text-slate-500">Fill in the basics, pick a template, and generate.</div>
            </div>
            <div className="card-c space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Company</label>
                  <input className="input" value={company} onChange={e=>setCompany(e.target.value)} placeholder="e.g., Swatch Group" />
                </div>
                <div>
                  <label className="label">Ticker</label>
                  <input className="input" value={ticker} onChange={e=>setTicker(e.target.value)} placeholder="e.g., UHR.SW" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Sector</label>
                  <input className="input" value={sector} onChange={e=>setSector(e.target.value)} placeholder="e.g., Luxury Watches" />
                </div>
                <div>
                  <label className="label">Region</label>
                  <input className="input" value={region} onChange={e=>setRegion(e.target.value)} placeholder="e.g., Europe" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Currency</label>
                  <input className="input" value={currency} onChange={e=>setCurrency(e.target.value)} placeholder="e.g., EUR" />
                </div>
                <div>
                  <label className="label">Investor profile</label>
                  <input className="input" value={investorProfile} onChange={e=>setInvestorProfile(e.target.value)} placeholder="e.g., Long-only" />
                </div>
              </div>
              <div>
                <label className="label">Focus</label>
                <input className="input" value={focus} onChange={e=>setFocus(e.target.value)} placeholder="e.g., Margin expansion + China recovery" />
              </div>
              <div>
                <label className="label">Constraints</label>
                <input className="input" value={constraints} onChange={e=>setConstraints(e.target.value)} placeholder="e.g., Max 2 pages" />
              </div>
              <div>
                <label className="label">Template</label>
                <select className="select" value={templateId} onChange={e=>setTemplateId(e.target.value)}>
                  {TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <p className="text-xs text-slate-500 mt-1">{TEMPLATES.find(t=>t.id===templateId)?.description}</p>
              </div>
              <hr/>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={includeAppendix} onChange={e=>setIncludeAppendix(e.target.checked)} />
                  Include Appendix
                </label>
                <button className="btn" onClick={()=>addSection()}>+ Section</button>
              </div>
              <div className="space-y-2">
                {customSections.map((s,i)=>(
                  <div className="flex items-center gap-2" key={i}>
                    <input className="input" value={s} onChange={e=>updateSection(i, e.target.value)}/>
                    <button className="btn" onClick={()=>removeSection(i)}>Remove</button>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 pt-2">
                <button className="btn btn-primary w-full" onClick={generateDraft} disabled={isGenerating}>
                  {isGenerating ? "Generating…" : "Generate Draft"}
                </button>
                <button className="btn" onClick={clearAll}>Reset</button>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-h">
              <div className="text-lg font-semibold">Follow-up</div>
              <div className="text-sm text-slate-500">Iterate on the memo via chat.</div>
            </div>
            <div className="card-c">
              <FollowUpBox onSend={sendFollowUp} disabled={isGenerating || !apiKey} />
            </div>
          </div>
        </div>

        {/* Right */}
        <div className="lg:col-span-2 space-y-4">
          <div className="card">
            <div className="card-h flex items-center justify-between">
              <div>
                <div className="text-lg font-semibold" style={{color: BRAND.primary}}>Investment Draft</div>
                <div className="text-sm text-slate-500">Rendered markdown of the latest assistant output.</div>
              </div>
              <button className="btn" onClick={()=>navigator.clipboard.writeText(draft)}>Copy</button>
            </div>
            <div className="card-c">
              <div ref={draftRef} className="prose max-w-none bg-white p-6 rounded-xl border">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft}</ReactMarkdown>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-h">
              <div className="text-lg font-semibold">Conversation</div>
              <div className="text-sm text-slate-500">Full message history for reproducibility.</div>
            </div>
            <div className="card-c">
              <div className="h-72 border rounded-xl p-4 bg-white overflow-auto space-y-4">
                {chat.length === 0 && <div className="text-sm text-slate-500">No conversation yet. Generate a draft, then ask follow-ups here.</div>}
                {chat.map((m, i)=>(
                  <div key={i} className={"rounded-lg p-3 border " + (m.role==="assistant"?"bg-slate-50": m.role==="user"?"bg-blue-50":"bg-amber-50")}>
                    <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">{m.role}</div>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {error && <div className="text-red-600 text-sm">{error}</div>}
        </div>
      </div>

      {/* Settings */}
      <div className="fixed right-4 bottom-4 bg-white border rounded-2xl shadow-lg max-w-md w-[380px]"
           style={{display: showSettings ? 'block' : 'none'}}>
        <div className="px-4 py-3 border-b font-semibold">Settings</div>
        <div className="p-4 space-y-4">
          <div>
            <label className="label">OpenAI API Key</label>
            <input type="password" className="input" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="sk-..." />
            <p className="text-xs text-slate-500 mt-1">Stored in your browser. In production, keep keys on the server.</p>
          </div>
          <div>
            <label className="label">Model</label>
            <select className="select" value={model} onChange={e=>setModel(e.target.value)}>
              <option value="gpt-5.1">gpt-5.1</option>
              <option value="gpt-4.1">gpt-4.1</option>
            </select>
          </div>
          <div>
            <label className="label">Temperature ({temperature})</label>
            <input type="range" min={0} max={1} step={0.1} value={temperature} onChange={e=>setTemperature(parseFloat(e.target.value))} />
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn" onClick={()=>setShowSettings(false)}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FollowUpBox({ onSend, disabled }: { onSend: (m: string)=>void, disabled?: boolean }) {
  const [msg, setMsg] = useState("");
  return (
    <div className="flex gap-2">
      <textarea className="textarea min-h-[60px]" value={msg} onChange={e=>setMsg(e.target.value)} placeholder="Ask for revisions, add assumptions, request tables…"/>
      <button className="btn btn-primary" disabled={disabled} onClick={()=>{ if(!msg.trim()) return; onSend(msg.trim()); setMsg(""); }}>Send</button>
    </div>
  );
}

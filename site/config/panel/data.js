// Synthetic data for the Hiring Panel demo: an invented company, roles, candidates and pay benchmark.
// Every person, figure and organisation here is fictional. Candidates' previous pay is deliberately absent.

export const COMPANY = "Fernhollow Group (synthetic)";

export const AGENTS = {
  hm: { id: "hm", name: "Iris", role: "Hiring Manager", colour: "#6EE7FF", glyph: "target" },
  tech: { id: "tech", name: "Theo", role: "Technical Assessor", colour: "#A78BFA", glyph: "code" },
  people: { id: "people", name: "Pia", role: "People Partner", colour: "#34D399", glyph: "people" },
  comp: { id: "comp", name: "Cato", role: "Compensation Analyst", colour: "#FBBF24", glyph: "band" },
  auditor: { id: "auditor", name: "Faye", role: "Fairness and Compliance Auditor", colour: "#F87171", glyph: "shield" },
  chair: { id: "chair", name: "Sol", role: "Chair", colour: "#EAF0FF", glyph: "gavel" }
};

// People Partner claims may also target these two dimensions, which are not role requirements.
export const PEOPLE_DIMENSIONS = {
  collaboration: { id: "collaboration", label: "Collaboration" },
  growth: { id: "growth", label: "Growth potential" }
};

export const ROLES = {
  "hr-systems-automation-manager": {
    id: "hr-systems-automation-manager",
    title: "HR Systems Automation Manager",
    level: "L5",
    location: "London",
    summary: "Leads the automation of HR and People processes, including LLM features, with sound governance.",
    requirements: [
      { id: "r1", label: "Workflow automation delivery", weight: 3, technical: true,
        question: "Which HR workflow have you automated end to end, and how did you measure the result?" },
      { id: "r2", label: "LLM and AI integration", weight: 3, technical: true,
        question: "Can you walk us through an LLM feature you built and how its outputs were tested before release?" },
      { id: "r3", label: "HR process knowledge", weight: 2, technical: false,
        question: "Which People processes have you mapped or redesigned, and what changed for HR advisers?" },
      { id: "r4", label: "Systems integration (HRIS, APIs)", weight: 2, technical: true,
        question: "Describe an integration you built between HR systems: the interfaces, failure handling and ownership." },
      { id: "r5", label: "Leadership and stakeholder management", weight: 2, technical: false,
        question: "Tell us about a time you led people or aligned HR, legal and IT stakeholders on a change." },
      { id: "r6", label: "Responsible AI and data protection", weight: 2, technical: false,
        question: "How have you assessed data protection and fairness risks for an AI feature in practice?" }
    ]
  },
  "people-analytics": {
    id: "people-analytics",
    title: "People Analytics Engineer",
    level: "L4",
    location: "Manchester",
    summary: "Builds the data models, analyses and dashboards behind workforce decisions, with privacy by design.",
    requirements: [
      { id: "r1", label: "SQL and data modelling", weight: 3, technical: true,
        question: "Describe a data model you designed for HR or operational data and the trade-offs you made." },
      { id: "r2", label: "Python for analysis and automation", weight: 3, technical: true,
        question: "Which analysis or automation have you written in Python, and how did you test it?" },
      { id: "r3", label: "HR metrics and processes", weight: 2, technical: false,
        question: "Which workforce metrics have you defined or reported, and how were they used?" },
      { id: "r4", label: "Integration of HR data sources", weight: 2, technical: true,
        question: "How have you combined data from HRIS, payroll or other systems, and kept it reliable?" },
      { id: "r5", label: "Privacy, GDPR and responsible use", weight: 2, technical: false,
        question: "How have you applied data minimisation or anonymisation to people data?" }
    ]
  }
};

// Candidate documents. Agents may only cite text that appears verbatim (after normalisation) in these.
export const CANDIDATES = {
  "morgan-ellery": {
    id: "morgan-ellery",
    name: "Morgan Ellery",
    headline: "Senior Automation Engineer",
    profile: "Strong match",
    documents: {
      cv: "Senior Automation Engineer, Larkspur Logistics (2021 to present). Led the automation of 14 HR workflows, including onboarding, leaver processing and contract changes, cutting manual handling time by 62%. Built an LLM-assisted HR policy assistant with retrieval over 300 policy documents, with human review of every answer before release. Integrated the HRIS with payroll and the IT service desk through REST APIs and webhooks, with retries and alerting on failed events. Ran a data protection impact assessment with the DPO for each AI use case. Previously Process Analyst, Brightwater Health Trust (2017 to 2021): mapped recruitment and absence processes and introduced a ticketing workflow used by 40 HR advisers. Skills: Python, JavaScript, Power Automate, SQL, prompt evaluation, process mapping.",
      cover: "I want to lead automation where it gives people teams more time for people. At Larkspur I chaired a fortnightly design review with HR business partners, legal and IT, and I learnt that adoption depends on explaining why a workflow behaves as it does. I would like to build an evaluation practice for AI features before they reach employees, with clear owners and published test results.",
      interview: "Explained a rollback they ran when an automated leaver workflow revoked access too early; described the root cause and the new approval step clearly. Walked through how they measure answer quality for the policy assistant with a weekly sample of 50 answers scored by HR advisers. Mentored two junior developers and ran the team's code review rota. Less exposure to SQL data modelling at scale; has written reporting queries but not designed a warehouse schema. Asked thoughtful questions about how the People team prioritises automation requests."
    }
  },
  "jordan-vale": {
    id: "jordan-vale",
    name: "Jordan Vale",
    headline: "HR Systems Coordinator",
    profile: "Mixed evidence",
    documents: {
      cv: "HR Systems Coordinator, Quarrybank Retail (2022 to present). Maintains HRIS configuration and user access for 2,500 employees. Built spreadsheet macros that merge weekly absence reports from twelve stores into one file for the HR team. Took part in a pilot of a chatbot for HR queries run by an external supplier. Previously HR Administrator, Quarrybank Retail (2019 to 2022): processed starters, leavers and contract changes, and kept the starter checklist up to date. Certificate in Python for beginners (2024). Skills: Excel, HRIS administration, basic Python, stakeholder communication.",
      cover: "I know HR processes from the inside and I am excited about automation. I have read a great deal about large language models and I believe I could lead an automation programme. I work well with managers and I am the person colleagues ask when the system misbehaves. I would bring energy and a practical view of what HR advisers actually need. I would welcome a structured development plan for the technical parts of the role.",
      interview: "Strong on HR process detail; described the starter checklist and the leaver steps accurately and in order. When asked about API integrations, said they had not built one but had watched the supplier's team configure the chatbot. Could not describe how the chatbot's answers were tested or who signed them off. Has not led a team; coordinated a two-person rota for HRIS support during the annual pay review. Wrote a short Python script to rename report files but has not used it for analysis. Enthusiastic and well prepared, with clear examples of helping store managers."
    }
  },
  "alex-rowan": {
    id: "alex-rowan",
    name: "Alex Rowan",
    headline: "Head of HR Technology",
    profile: "Strong, with bias traps in the documents",
    documents: {
      cv: "Head of HR Technology, Saltmarsh Insurance (2021 to present). Designed and delivered an automation programme covering 22 HR processes. Built an LLM triage service for employee queries that routes 70% of tickets without manual sorting; every routing rule is logged and reviewed monthly. Built an integration layer between the HRIS, payroll and the learning platform using event-driven APIs. Led a team of six engineers and analysts. Career break (2019 to 2021) to care for a family member. Previously HR Systems Lead, Northgate Mutual (2008 to 2019), where they owned SQL reporting and the HR data model. BSc Computer Science, graduated 1994. Wrote the company's guidance on fair use of AI in recruitment, reviewed by the works council.",
      cover: "I return to the questions of trust and transparency in every automation I build. I came back to the field in 2021 after my career break. Since then I have rebuilt my skills in LLM evaluation and completed a course on the EU AI Act. I would like to help Fernhollow automate People processes in a way employees can understand and challenge.",
      interview: "Gave a precise account of how the triage service was evaluated against a labelled set of 1,200 historical tickets before go-live, including the error rate by ticket category. Strong answer on data minimisation and retention for employee query logs. Described weekly prioritisation sessions with HR business partners. Mentioned two children at primary school and asked whether Tuesday finishes at 4pm are possible. Interviewer remark: very experienced, possibly a little senior in years for a young team; worth checking energy levels."
    }
  }
};

export const DOCUMENT_LABELS = { cv: "CV", cover: "Cover note", interview: "Interview notes" };

// Synthetic annual base pay in GBP. Invented figures: not drawn from any real survey or vendor.
export const BENCHMARK = {
  source: "Synthetic benchmark (invented for this demo, 2026)",
  rows: [
    { roleId: "hr-systems-automation-manager", level: "L4", location: "London", p25: 68000, p50: 74000, p75: 80000 },
    { roleId: "hr-systems-automation-manager", level: "L5", location: "London", p25: 78000, p50: 85000, p75: 92000 },
    { roleId: "hr-systems-automation-manager", level: "L5", location: "Manchester", p25: 70000, p50: 76000, p75: 82000 },
    { roleId: "people-analytics", level: "L4", location: "London", p25: 60000, p50: 66000, p75: 71000 },
    { roleId: "people-analytics", level: "L4", location: "Manchester", p25: 52000, p50: 57000, p75: 62000 },
    { roleId: "people-analytics", level: "L5", location: "Manchester", p25: 61000, p50: 67000, p75: 73000 }
  ]
};

// Internal pay policy (synthetic). The offer never exceeds P75 or the internal equity cap.
export const POLICY = {
  floor: "p25",
  ceiling: "p75",
  roundTo: 500,
  equityCaps: {
    "hr-systems-automation-manager:L5": 89000,
    "hr-systems-automation-manager:L4": 78000,
    "people-analytics:L4": 61000,
    "people-analytics:L5": 72000
  },
  note: "Offers start at P25, never exceed P75 and never exceed the internal equity cap for the level. Previous pay is never asked for or used."
};

export function documentsText(candidateId) {
  const docs = CANDIDATES[candidateId].documents;
  return Object.keys(DOCUMENT_LABELS).map((key) => docs[key]).join("\n");
}

// Each assessor has its own lens: the Technical Assessor scores technical requirements only, and the
// People Partner scores collaboration, growth and the non-technical requirements.
export function requirementIds(roleId, agentId) {
  const reqs = ROLES[roleId].requirements;
  if (agentId === "tech") return reqs.filter((r) => r.technical).map((r) => r.id);
  if (agentId === "people") return [...Object.keys(PEOPLE_DIMENSIONS), ...reqs.filter((r) => !r.technical).map((r) => r.id)];
  return reqs.map((r) => r.id);
}

export function requirementLabel(roleId, reqId) {
  return ROLES[roleId].requirements.find((r) => r.id === reqId)?.label || PEOPLE_DIMENSIONS[reqId]?.label || reqId;
}

export function publicCatalogue() {
  return {
    company: COMPANY,
    agents: Object.values(AGENTS),
    roles: Object.values(ROLES).map(({ id, title, level, location, summary, requirements }) => ({
      id, title, level, location, summary,
      requirements: requirements.map(({ id: rid, label, weight, technical }) => ({ id: rid, label, weight, technical }))
    })),
    candidates: Object.values(CANDIDATES).map(({ id, name, headline, profile, documents }) => ({ id, name, headline, profile, documents })),
    documentLabels: DOCUMENT_LABELS,
    benchmark: BENCHMARK,
    policy: { note: POLICY.note }
  };
}

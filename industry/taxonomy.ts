// 类别 key 用于网址和订阅地址，发布后保持稳定；标签与机构名录可随运营补充。
export const CATEGORIES = [
  { key: "migration-policy", tagColor: "indigo", label: "移民政策", feedLabel: "移民政策", section: "移民政策", guide: "联邦移民政策、立法、年度规划、技术移民规则与职业清单。以州担保、雇主担保、留学为核心的变化优先归对应类别；办理流程归签证办理。" },
  { key: "state-nomination", tagColor: "turquoise", label: "州担保与邀请", section: "州担保与邀请", guide: "各州及领地担保开放、关闭、配额、州职业清单、ROI 与邀请轮次；联邦 SkillSelect 邀请结果也归此类。不同州、签证子类与轮次分别辨认。" },
  { key: "employer-sponsored", tagColor: "green", label: "雇主担保", section: "雇主担保", guide: "雇主担保签证、提名、劳工协议、DAMA、薪资门槛、雇主义务与担保合规。普通招聘广告不属于政策变化。" },
  { key: "visa-process", tagColor: "orange", label: "签证办理", section: "签证办理", guide: "申请费、材料、审理优先级、审理时间数据、系统与递交步骤，以及配偶、父母、访客等签证办理变化。学生及毕业生签证归留学与毕业生，雇主担保专门规则归雇主担保。" },
  { key: "study-graduates", tagColor: "violet", label: "留学与毕业生", section: "留学与毕业生", guide: "国际教育政策、学生与毕业生签证、GS、CoE、资金与英语要求、转学、工作权利和影响国际学生的院校变化。机构处罚、注册撤销及执法案件归行业监管。" },
  { key: "industry", tagColor: "purple", label: "行业监管", feedLabel: "行业监管", section: "行业监管", guide: "移民代理、教育代理及院校监管，ESOS、CRICOS、TEQSA、ASQA 的执法与合规，重要判决、诈骗和消费者保护。提案与已生效措施必须区分。" },
] as const satisfies ReadonlyArray<{ key: string; tagColor: string; label: string; feedLabel?: string; section: string; guide: string; commentary?: true }>;

// 计数为政策动态，不代表每条措施均已生效；政策阶段由摘要保留。
export const RELEASE: { category: string; tag: string; unit: string } | null = { category: "migration-policy", tag: "政策变化", unit: "项政策动态" };
export const PLAIN_TERMS: readonly string[] = ["eoi", "roi", "pr", "gs", "coe", "cricos", "esos", "dama", "ielts", "pte", "aud", "nsw", "vic", "qld", "sa", "wa", "tas", "act", "nt"];
// 保留七类内容及原五维权重结构，换成本站行业语义。
export const ITEM_TYPES = ["policy_change", "program_update", "application_guide", "research_report", "industry_event", "opinion_analysis", "tutorial_explainer"] as const;
export const CATEGORY_TAGS = ["政策变化", "项目更新", "邀请与配额", "费用与审理", "申请指南", "数据报告", "政策解读", "监管执法", "行业动态", "其他"] as const;
export const TOPIC_TAGS = [
  "技术移民", "州担保", "雇主担保", "学生签证", "毕业生签证", "家庭签证", "访客签证", "职业评估", "英语要求", "工作权利", "移民规划", "院校合规",
  "189", "190", "491", "482", "186", "494", "500", "485", "EOI", "ROI", "DAMA", "NSW", "VIC", "QLD", "SA", "WA", "TAS", "ACT", "NT",
] as const;
export const ENTITY_TAGS = ["Home Affairs", "教育部", "TEQSA", "ASQA", "OMARA", "Migration NSW", "Migration Victoria", "Migration Queensland", "Migration SA", "Migration WA", "Migration Tasmania", "ACT Migration", "Migration NT", "Study Australia"] as const;
export const TAG_SYNONYMS: Readonly<Record<string, string>> = {
  政策: "政策变化", 法规: "政策变化", "政策/监管": "政策变化", 项目: "项目更新", 邀请: "邀请与配额", 配额: "邀请与配额", 费用: "费用与审理", 审理: "费用与审理",
  指南: "申请指南", 教程: "申请指南", "教程/实践": "申请指南", 研究: "数据报告", 报告: "数据报告", 解读: "政策解读", 观点: "政策解读", 监管: "监管执法", 执法: "监管执法",
  "State nomination": "州担保", "Expression of Interest": "EOI", "Registration of Interest": "ROI",
  新州: "NSW", 维州: "VIC", 昆州: "QLD", 南澳: "SA", 西澳: "WA", 塔州: "TAS", 首都领地: "ACT", 北领地: "NT", 内政部: "Home Affairs", 澳洲教育部: "教育部",
};
export const ENTITIES: Record<string, { name: string; displayTag: string | null; aliases: string[]; orgNames?: string[]; otherNames?: string[] }> = {
  "home-affairs": { name: "澳洲内政部", displayTag: "Home Affairs", aliases: ["Department of Home Affairs", "Home Affairs", "内政部"], orgNames: ["Department of Home Affairs", "Home Affairs", "澳洲内政部", "澳大利亚内政部"] },
  "education-au": { name: "澳洲教育部", displayTag: "教育部", aliases: ["Department of Education", "Australian Government Department of Education", "澳洲教育部"], orgNames: ["Department of Education", "澳洲教育部"] },
  "migration-nsw": { name: "新州移民局", displayTag: "Migration NSW", aliases: ["NSW Government", "NSW Business and Skilled Migration", "Migration NSW", "新州"], orgNames: ["NSW Government", "新州政府"] },
  "migration-vic": { name: "维州移民局", displayTag: "Migration Victoria", aliases: ["Live in Melbourne", "Victorian Government", "维州", "Victoria"], orgNames: ["Victorian Government", "维州政府"] },
  "migration-qld": { name: "昆州移民局", displayTag: "Migration Queensland", aliases: ["Migration Queensland", "昆州"], orgNames: ["Migration Queensland", "Queensland Government", "昆州政府"] },
  "migration-sa": { name: "南澳移民局", displayTag: "Migration SA", aliases: ["Skilled & Business Migration", "Migration SA", "South Australia", "南澳"], orgNames: ["Migration SA", "南澳政府"] },
  "migration-wa": { name: "西澳移民服务", displayTag: "Migration WA", aliases: ["Migration WA", "Western Australia", "西澳"], orgNames: ["Migration WA", "西澳政府"] },
  "migration-tas": { name: "塔州移民局", displayTag: "Migration Tasmania", aliases: ["Migration Tasmania", "Tasmania", "塔州"], orgNames: ["Migration Tasmania", "塔州政府"] },
  "migration-act": { name: "首都领地移民机构", displayTag: "ACT Migration", aliases: ["ACT Government", "Canberra Matrix", "ACT Migration", "首都领地"], orgNames: ["ACT Government", "首都领地政府"] },
  "migration-nt": { name: "北领地移民机构", displayTag: "Migration NT", aliases: ["Migration NT", "Northern Territory Government", "北领地"], orgNames: ["Migration NT", "北领地政府"] },
  teqsa: { name: "TEQSA", displayTag: "TEQSA", aliases: ["TEQSA", "Tertiary Education Quality and Standards Agency"], orgNames: ["TEQSA"] },
  asqa: { name: "ASQA", displayTag: "ASQA", aliases: ["ASQA", "Australian Skills Quality Authority"], orgNames: ["ASQA"] },
  omara: { name: "OMARA", displayTag: "OMARA", aliases: ["OMARA", "Office of the Migration Agents Registration Authority"], orgNames: ["OMARA"] },
  "study-australia": { name: "Study Australia", displayTag: "Study Australia", aliases: ["Study Australia", "Austrade", "Australian Trade and Investment Commission"], orgNames: ["Study Australia", "Austrade"] },
};
// 只校验明确机构名，避免用州名、签证号码或 GS/SA 等歧义简称拒绝正常翻译。
export const IDENTITY_LEXICON: ReadonlyArray<{ id: string; name: string; patterns: RegExp[] }> = [
  { id: "home-affairs", name: "澳洲内政部", patterns: [/\bHome Affairs\b|内政部/i] },
  { id: "education-au", name: "澳洲教育部", patterns: [/\bDepartment of Education\b|澳洲教育部|澳大利亚教育部/i] },
  { id: "teqsa", name: "TEQSA", patterns: [/\bTEQSA\b|Tertiary Education Quality and Standards Agency/i] },
  { id: "asqa", name: "ASQA", patterns: [/\bASQA\b|Australian Skills Quality Authority/i] },
  { id: "omara", name: "OMARA", patterns: [/\bOMARA\b|Office of the Migration Agents Registration Authority/i] },
];
export const PUBLISHER_DOMAINS: ReadonlyArray<{ entityId: string; domains: readonly string[] }> = [
  { entityId: "home-affairs", domains: ["homeaffairs.gov.au"] },
  { entityId: "education-au", domains: ["education.gov.au"] },
  { entityId: "migration-vic", domains: ["liveinmelbourne.vic.gov.au"] },
  { entityId: "migration-qld", domains: ["migration.qld.gov.au"] },
  { entityId: "migration-sa", domains: ["migration.sa.gov.au"] },
  { entityId: "migration-wa", domains: ["migration.wa.gov.au"] },
  { entityId: "migration-tas", domains: ["migration.tas.gov.au"] },
  { entityId: "teqsa", domains: ["teqsa.gov.au"] },
  { entityId: "asqa", domains: ["asqa.gov.au"] },
  { entityId: "study-australia", domains: ["studyaustralia.gov.au"] },
];
export const IDENTITY_CONTEXT_ALIASES: ReadonlyArray<{ entityId: string; pattern: RegExp }> = [];

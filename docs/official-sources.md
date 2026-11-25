# 澳洲官方信源接入清单

截至 2026 年 11 月 23 日，本地后台启用了 40 个澳洲政府及职业评估机构的官方入口，覆盖移民、签证、州担保、国际教育及相关监管。信源定义在 [industry/sources.json](../industry/sources.json)。后台可查看每次采集、发现数量和下次到期时间。

## 新闻列表与官方 API

| 信源 ID | 官方入口 | 采集范围 |
|---|---|---|
| `au-home-affairs-news` | [内政部移民与公民新闻](https://immi.homeaffairs.gov.au/news-media/archive) | 官方 GetNews 接口与公告原始日期。 |
| `au-home-affairs-portfolio` | [内政部综合公告](https://www.homeaffairs.gov.au/news-media/archive) | 官方 GetNews 接口，包括移民代理监管等综合信息。 |
| `au-home-affairs-minister` | [内政与移民部长](https://minister.homeaffairs.gov.au/TonyBurke) | 官方 RSS，采用原始链接和 pubDate。 |
| `au-immigration-assistant-minister` | [移民助理部长](https://minister.homeaffairs.gov.au/MattThistlethwaite) | 官方 RSS。 |
| `au-international-education-minister` | [国际教育助理部长](https://minister.homeaffairs.gov.au/JulianHill) | 官方 RSS。 |
| `au-federal-legislation` | [联邦法规登记册 API](https://www.legislation.gov.au/help-and-resources/using-the-legislation-register/data-share-and-reuse) | 查找标题含 Migration 的新近登记文件，采用 asMadeRegisteredAt 的日历日和登记编号。 |
| `au-nsw-news` | [新州移民新闻](https://www.nsw.gov.au/visas-and-migration/news-and-updates) | 新闻列表与 datetime；现阶段的近期技术迁移变化需结合下表项目正文。 |
| `au-vic-news` | [维州州担保新闻](https://liveinmelbourne.vic.gov.au/news-events/news) | 新闻列表与原文日期。 |
| `au-qld-news` | [昆州州担保新闻](https://migration.qld.gov.au/news) | 兼容 11 月 23 日核验的新旧列表样式。详情页明确标注 Last published 时按昆州 UTC+10 读取；新版未标注日期的项目保留缺省。云端收到官网 HTTP 429 时按采集失败记录。 |
| `au-sa-news` | [南澳移民项目新闻](https://migration.sa.gov.au/news) | 新闻列表与英文序数日期。 |
| `au-wa-news` | [西澳州担保新闻](https://migration.wa.gov.au/news) | 新闻列表与带时区的 datetime。 |
| `au-tas-news` | [塔州移民新闻](https://www.migration.tas.gov.au/news) | 新闻列表；下表两个原址更新的页面由独立任务监测。 |
| `au-nt-migration` | [北领地主管部门新闻](https://dtbar.nt.gov.au/news) | 移民与劳动力新闻。 |
| `au-education-news` | [教育部国际教育公告](https://www.education.gov.au/announcements/international-education) | 国际教育主题公告。 |
| `au-education-ministers` | [教育部部长媒体中心](https://ministers.education.gov.au/) | 部长声明、新闻稿和讲话。 |
| `au-study-australia` | [Study Australia 教育代理公告](https://www.studyaustralia.gov.au/en/Agent-Hub/agent-news-index) | Austrade 官方教育代理新闻及日期。 |
| `au-teqsa-news` | [TEQSA 监管新闻](https://www.teqsa.gov.au/about-us/news-and-events/latest-news) | 高等教育监管新闻，日期可由详情页补齐。 |
| `au-asqa-news` | [ASQA 新闻与提醒](https://www.asqa.gov.au/newsroom/latest-news) | 职业教育监管、新闻与提醒。 |
| `au-jsa-news` | [Jobs and Skills Australia 新闻](https://www.jobsandskills.gov.au/news) | 技能、就业与移民研究相关更新。 |
| `au-dewr-ministers` | [就业与劳资关系部部长发布](https://ministers.dewr.gov.au/) | 部长声明、讲话和新闻稿。 |
| `au-fair-work-news` | [Fair Work 新闻](https://www.fairwork.gov.au/newsroom) | 劳动权益新闻，包括移民工人、留学生工作与雇主合规。 |
| `au-abs-migration` | [ABS 人口统计](https://www.abs.gov.au/statistics/people/population) | 海外移民、全国及分州人口、出生国人口与地区人口四组数据，采用 Original publication date。 |
| `au-vetassess-news` | [VETASSESS News & Updates](https://www.vetassess.com.au/news) | 读取标记为 News 或 Updates 的新闻卡，从详情页获取正文及发布日期。首次最多回填 5 篇。 |

三个部长 RSS 使用官网公开的 RSS 地址，保留条件请求。维州、塔州、北领地主管部门，以及部分联邦教育与就业站点的列表通过 [Jina Reader 公开网页读取服务](https://jina.ai/en-US/api-dashboard/rate-limit/) 获取 HTML，再读取官方结构及原文链接。公开读取使用共享限额，每进程间隔至少 3.1 秒；请求允许 15 分钟的事先读取缓存。其余列表直接请求官方入口。

## 昆州待审线索

[qld-google-news-leads](https://news.google.com/rss/search?q=site%3Awww.migration.qld.gov.au%2Fnews&hl=en-AU&gl=AU&ceid=AU%3Aen) 由 GitHub Actions 每 4 小时采集。后台在「信源 → 昆州移民新闻 · RSS（待审线索）」查看。每轮同时检查 Google 新闻与 [VisaRadar 的昆州 RSS](https://visaradar-au.github.io/visaradar/states/qld/news.xml)。Google 新闻无法读取或没有有效线索时，切到备用订阅。备用订阅仅接收指向 Migration Queensland 官方新闻正文的链接。两个订阅分别记录读取结果，各自按链接去重。遇到旧网址或不同链接指向同一公告时，由编辑核对。待审条目保留标题和链接，正文与原始发布日期留空。核实昆州移民局原文后，可用官方链接另行收录。官方新闻源 `au-qld-news` 继续记录官网的实测状态。

手动运行 Australia Policy Radar collection 时可勾选 `qld_leads_only`。定时运行时先读取待审线索，再采集官方信源。

## 原址更新页面

| 信源 ID | 官方入口 | 监测内容 |
|---|---|---|
| `au-act-news` | [ACT Migration](https://www.act.gov.au/migration) | 移民总页正文及项目通知。 |
| `au-nsw-skilled` | [新州技术签证](https://www.nsw.gov.au/visas-and-migration/skilled-visas) | 当前项目状态及要点。 |
| `au-nt-dama` | [北领地 DAMA](https://dtbar.nt.gov.au/workforce-population/northern-territory-designated-area-migration-agreement/important-update-on-the-nt-dama-program) | DAMA 公告原址更新。 |
| `au-tas-roi` | [塔州 ROI 状态](https://www.migration.tas.gov.au/news/important-update-roi-system-currently-offline) | ROI 系统和恢复公告。 |
| `au-tas-rounds` | [塔州配额与邀请](https://www.migration.tas.gov.au/news/processing_times_and_allocation_usage) | 项目受理、剩余配额和邀请正文。 |
| `au-omara-notices` | [OMARA 官方通知](https://www.mara.gov.au/notices-and-reports/news-and-notices/notices) | 代理监管通知正文。 |
| `au-act-invitation-rankings` | [ACT Canberra Matrix 邀请排名](https://www.act.gov.au/migration/resources/library-guidelines-and-invitations) | 从资料库跟随最新项目年度的官方排名 PDF，读取轮次日期和分数表。 |
| `au-visa-fees` | [内政部签证费用表](https://immi.homeaffairs.gov.au/visas/getting-a-visa/fees-and-charges/current-visa-pricing/) | 读取原页和其公开的 GetPriceList 查询，比较签证子类、各项费用及备注。 |
| `au-student-visa-priorities` | [学生签证审理优先级](https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-processing-times/visa-processing-priorities/student-visa) | 监测境内外处理规则、优先级说明和部长指令链接。 |
| `au-education-provider-priorities` | [教育部院校优先级](https://www.education.gov.au/managed-system-international-education/resources/visa-prioritisation-status) | 从教育部原页查找当期 DOCX，读取院校 CRICOS 编号、参考配额及优先级。云端通过悉尼函数请求原页和文件。 |
| `au-employer-salary-thresholds` | [雇主提名薪资要求](https://immi.homeaffairs.gov.au/employer-subsite/Pages/salary-requirements.aspx) | 读取官网嵌入的薪资页签，监测 CSIT、SSIT、TSMIT 的金额、适用日期与市场薪资规则。 |
| `au-vic-points-test` | [维州 VPT](https://liveinmelbourne.vic.gov.au/migrate/skilled-migration-visas/vpt) | 监测七项排序要素、两个签证子类的 ROI 邀请及优先行业。 |
| `au-skilled-visa-priorities` | [技术签证审理优先级](https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-processing-times/visa-processing-priorities/skilled-visa) | 监测临时、过渡及永久技术签证的排序规则与部长指令 PDF 链接。 |
| `au-nsw-skills-lists` | [新州技术移民清单](https://www.nsw.gov.au/visas-and-migration/skilled-visas/nsw-skills-lists) | 读取实际 ANZSCO 职业组表，以及 190 和 491 的清单更新说明。 |
| `au-tra-jrp-fees` | [TRA Job Ready Program 费用](https://www.tradesrecognitionaustralia.gov.au/fees-1) | 从官方原页读取费用图表的替代文字、金额和图片链接。云端通过悉尼函数请求原页。 |
| `au-cricos-register` | [CRICOS 官方名录](https://cricos.education.gov.au/) | 以塔斯马尼亚大学（00586B）和 TAFE NSW（00591E）试点，读取登记编号、容量、校区和原页展示的课程。 |
| `au-national-training-register` | [国家培训登记册](https://training.gov.au/organisation/details/90003) | 以 TAFE NSW（RTO 90003）试点，通过登记册公开接口读取注册状态、注册期限、当前及历史监管决定与范围概览。 |

两个名录按上述试点编号采集。维州 VPT 使用公开网页读取服务获取渲染后的内容。

监测首次读取时建立基线，有变化时记录同一原文的版本，重复读取保留采集记录。首次观察时间供核查使用，未确认的发布日期保持空白。法规登记日与生效日需分别核对。首次发现的历史公告保留原始日期。所有来源默认只公开摘要和原文链接。

## 本地运行

本地服务运行期间，列表采集和页面监测每 5 分钟检查到期任务。每个官方入口成功后间隔 240 分钟再次到期，队列会错开网络请求并发。后台可在信源日志查看成功、失败、首次监测、正文变化和下次检查时间。站点启用采集和正文提取，模型调用处于关闭状态，首页和报刊由编辑核实后更新。

北领地 [州提名入口](https://australiasnorthernterritory.com.au/move/migrate-to-work/nt-government-visa-nomination) 仍返回访问验证，目前通过同一政府主管部门的新闻和 DAMA 补充覆盖。本机后台尚未稳定读到 [SkillSelect 联邦邀请轮次](https://immi.homeaffairs.gov.au/visas/working-in-australia/skillselect/rounds/invitation-rounds) 的表格。院校各自发布的公告、其他职业评估机构与法院判决仍需逐站接入。内政部 GetNews 的 Year 当前为 2026，跨年前还需更新后台源配置。已有站点升级时需同步数据库，重跑 seed 只补新 ID。

## 2026 年 11 月 18 日运行核验

北京时间 15:01–15:11 的核验中，28 个入口的最新采集记录全部为成功，包含 22 个新闻列表或 API、6 个页面正文监测；数据库信源配置与仓库定义一致。本轮新增 30 条待审核材料。TEQSA 新闻列表读取成功，其中 4 条详情暂未读到，采集器保留待补读记录。

后台队列按计划执行了 15:05 和 15:10 两轮。5 个此前超时的入口设为再次到期，由 15:10 的定时队列重试，全部恢复。下次到期时间分布于北京时间当天 19:01–19:10，随后由定时队列领取。首次记录的 6 个页面均已建立基线，复检时正文相同。

已通过 `npm run typecheck`、`npm test`（1149 通过、1 跳过）、网页构建、`npm run test:web`（61 通过）以及针对本地站的 `node scripts/smoke.ts --base http://localhost:3000`。核验期间模型开关关闭，无新增付费回执。

## 2026 年 11 月 23 日新增监测核验

北京时间 16:20 的定时任务首轮完成，三个新入口均成功建立快照。ACT 官方排名 PDF 包含 10 月 12 日和 11 月 12 日两轮。内政部费用表返回 150 行实际费用。学生签证优先级原页的境内外规则及两份部长指令链接已归档。三个来源下次于当天 20:20 左右到期。回归测试覆盖费用金额变化和部长指令链接替换。

北京时间 16:50 建立了本轮另 8 个页面快照，并回填 VETASSESS 的 5 篇正文。16:55 的定时队列再次领取 9 个新增入口，全部成功。8 个快照均无变化，VETASSESS 为 5 篇已入库文章补齐官网发布日期。教育部快照读到 197 个院校编号，新州原页读到 78 条 ANZSCO 职业组。各入口下次于 20:55:38–20:55:47 到期，等待下一次队列检查。核验期间模型调用关闭，无新增付费回执。

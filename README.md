# 澳洲政策雷达

澳洲移民、签证与留学行业热点站。优先追踪官方政策和州担保消息，关注规则、配额、邀请、费用与监管变化；把同一件事的报道归组，生成中文精选及日报、周报、月报。

分类为：移民政策、州担保与邀请、雇主担保、签证办理、留学与毕业生、行业监管。公开入口包括网页、RSS、API、Agent Markdown 和 MCP。报刊时刻均为北京时间：日报 08:00，周一周报 10:00，每月 1 日月报 10:30。

## 先读行业交接

[行业配置、信源验证与上线待办](docs/australia.md) 说明默认关注范围、5 个启用的官方源和 7 个暂停候选、访问与日期限制、内政部接口的跨年维护，以及正式条款、模型服务和样本校准等待确认事项。当前配置不等于全量政策监测；原址修改的清单和费用表尚需页面变更采集。

标题摘要区分政策提案、正式公布和生效阶段，保留签证子类、州别与适用条件。默认只展示摘要和原文链接，不开放未经许可的全文转载。

## 本机运行

需要 Node.js 24.22.1 以上、PostgreSQL 17；推荐 Docker Compose，Windows 的非 Docker 运行使用 WSL2。完整步骤见 [部署](docs/deploy.md)。

```bash
npm ci --no-audit --no-fund
node scripts/init-env.ts --llm-key <你的模型服务密钥>
docker compose up -d --build
```

部署前设置正确的 `SITE_URL`，确认运营信息、正式使用规则与隐私说明，以及采集和模型预算。管理员入口为 `/admin`，机器接入说明为 `/agent`。开发验证保持采集、模型、推送和搜索引擎主动提交开关关闭；无需启动 worker。

已有 AI 示例站升级时先备份并读交接说明。种子只增加新信源 ID，不覆盖已有设置，也不会暂停或删除旧 AI 信源。公开接口现为 5.0.0，类别 key 与 MCP 前缀已切换；建议新行业使用独立数据库。

## 检查

测试库名必须以 `_test` 或 `_ci` 结尾，账号需能创建测试数据库；测试使用本地模型和采集假服务。浏览器测试先安装 Chromium 与 WebKit。

```bash
npm run typecheck
DATABASE_URL=postgres://<账号>:<密码>@127.0.0.1:5432/au_policy_radar_test npm test
npm run build -w @aihot/web
npx playwright install --with-deps chromium webkit
npm run test:web
node scripts/smoke.ts --base http://localhost:3000
```

冒烟检查前先按部署文档迁移、导入种子，并启动 API 和网页服务。代码测试不代替真实选稿评测：保留的默认门槛仍需用使用者标注的 100–200 条真实资料校准。

## 配置位置

| 位置 | 用途 |
|---|---|
| `site/site.ts` | 站名、文案、出刊时间、公开接口身份 |
| `site/brand/` | 本站雷达图标、字标与报刊报头 |
| `site/pages/` | 使用规则和隐私说明草案，待运营者确认 |
| `industry/taxonomy.ts`、`topics.json` | 分类、标签、机构和主题 |
| `industry/sources.json` | 新部署的初始官方信源；运行后在后台管理 |
| `industry/prompts/`、`selection.ts` | 行业判断规则和保留的默认门槛 |

框架说明见 [定制](docs/customize.md)、[信源](docs/sources.md)、[精选与校准](docs/selection.md)、[架构](docs/architecture.md)。

基于 [AIHOT 开源框架](https://github.com/KKKKhazix/AIHOT) 定制，采用本站名称与雷达图标。代码许可见 [LICENSE](LICENSE)，字体许可见 [NOTICE](NOTICE)。

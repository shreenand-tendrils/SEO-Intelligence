-- CreateEnum
CREATE TYPE "CrawlStatus" AS ENUM ('QUEUED', 'RUNNING', 'POST_PROCESSING', 'SAVING', 'COMPLETED', 'STOPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "CrawlSource" AS ENUM ('APP', 'IMPORT');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Website" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "seedUrl" TEXT NOT NULL,
    "cms" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Website_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlJob" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "websiteId" TEXT,
    "name" TEXT NOT NULL,
    "seedUrl" TEXT NOT NULL,
    "status" "CrawlStatus" NOT NULL DEFAULT 'QUEUED',
    "source" "CrawlSource" NOT NULL DEFAULT 'APP',
    "legacyFile" TEXT,
    "savedBy" TEXT,
    "pagesCrawled" INTEGER NOT NULL DEFAULT 0,
    "queued" INTEGER NOT NULL DEFAULT 0,
    "fetchErrors" INTEGER NOT NULL DEFAULT 0,
    "progress" JSONB,
    "messages" JSONB,
    "stopReason" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrawlJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlConfiguration" (
    "id" TEXT NOT NULL,
    "crawlId" TEXT NOT NULL,
    "maxPages" INTEGER NOT NULL,
    "maxDepth" INTEGER NOT NULL,
    "maxWorkers" INTEGER NOT NULL,
    "crawlDelay" DOUBLE PRECISION NOT NULL,
    "renderJs" BOOLEAN NOT NULL,
    "compareNoJs" BOOLEAN NOT NULL,
    "ignoreRobots" BOOLEAN NOT NULL,
    "ignoreNoindex" BOOLEAN NOT NULL,
    "solveChallenges" BOOLEAN NOT NULL,
    "userAgent" TEXT NOT NULL DEFAULT '',
    "includePatterns" TEXT NOT NULL DEFAULT '',
    "excludePatterns" TEXT NOT NULL DEFAULT '',
    "sitemap" BOOLEAN NOT NULL,
    "nearDup" BOOLEAN NOT NULL,
    "nearDupThreshold" DOUBLE PRECISION NOT NULL,
    "nearDupExclude" TEXT NOT NULL DEFAULT '',
    "botCheck" BOOLEAN NOT NULL,
    "botSample" INTEGER NOT NULL,
    "settings" JSONB NOT NULL,

    CONSTRAINT "CrawlConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawledPage" (
    "id" TEXT NOT NULL,
    "crawlId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL DEFAULT 0,
    "contentType" TEXT,
    "indexable" BOOLEAN NOT NULL DEFAULT true,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT,
    "titleLength" INTEGER NOT NULL DEFAULT 0,
    "metaDescription" TEXT,
    "metaLength" INTEGER NOT NULL DEFAULT 0,
    "h1" TEXT,
    "canonical" TEXT,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "internalLinks" INTEGER NOT NULL DEFAULT 0,
    "externalLinks" INTEGER NOT NULL DEFAULT 0,
    "imagesTotal" INTEGER NOT NULL DEFAULT 0,
    "imagesNoAlt" INTEGER NOT NULL DEFAULT 0,
    "responseTime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "redirectUrl" TEXT,
    "inlinkCount" INTEGER NOT NULL DEFAULT 0,
    "fetchError" TEXT,
    "issueCount" INTEGER NOT NULL DEFAULT 0,
    "criticalCount" INTEGER NOT NULL DEFAULT 0,
    "highCount" INTEGER NOT NULL DEFAULT 0,
    "seoScore" INTEGER,
    "scoreVersion" TEXT,
    "scoreBreakdown" JSONB,
    "data" JSONB NOT NULL,
    "bodyText" TEXT,

    CONSTRAINT "CrawledPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageIssue" (
    "id" TEXT NOT NULL,
    "crawlId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "groupLabel" TEXT NOT NULL,
    "crawlerSeverity" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "category" TEXT NOT NULL,
    "checkKey" TEXT,
    "convention" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PageIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlReport" (
    "id" TEXT NOT NULL,
    "crawlId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "CrawlReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlInlink" (
    "id" TEXT NOT NULL,
    "crawlId" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "anchor" TEXT NOT NULL DEFAULT '',
    "placement" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "CrawlInlink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeoScore" (
    "id" TEXT NOT NULL,
    "crawlId" TEXT NOT NULL,
    "algorithmVersion" TEXT NOT NULL,
    "pageAlgorithm" TEXT NOT NULL,
    "overall" INTEGER NOT NULL,
    "grade" TEXT NOT NULL,
    "components" JSONB NOT NULL,
    "severityCounts" JSONB NOT NULL,
    "caps" JSONB NOT NULL,
    "stats" JSONB NOT NULL,
    "explanation" JSONB NOT NULL,
    "pagesAnalyzed" INTEGER NOT NULL,
    "pagesWithErrors" INTEGER NOT NULL,
    "pagesExcellent" INTEGER NOT NULL,
    "pagesNeedAttention" INTEGER NOT NULL,
    "criticalCount" INTEGER NOT NULL,
    "highCount" INTEGER NOT NULL,
    "mediumCount" INTEGER NOT NULL,
    "lowCount" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeoScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeoCategoryScore" (
    "id" TEXT NOT NULL,
    "crawlId" TEXT NOT NULL,
    "pageId" TEXT,
    "scope" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "score" INTEGER,
    "weight" DOUBLE PRECISION NOT NULL,
    "earned" DOUBLE PRECISION NOT NULL,
    "possible" DOUBLE PRECISION NOT NULL,
    "passed" INTEGER NOT NULL,
    "failed" INTEGER NOT NULL,

    CONSTRAINT "SeoCategoryScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlComparison" (
    "id" TEXT NOT NULL,
    "baseCrawlId" TEXT NOT NULL,
    "targetCrawlId" TEXT NOT NULL,
    "algorithmVersion" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrawlComparison_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiConversation" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "crawlId" TEXT,
    "crawlRef" TEXT NOT NULL DEFAULT '',
    "ref" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiMessage" (
    "id" SERIAL NOT NULL,
    "conversationId" TEXT NOT NULL,
    "legacyId" INTEGER,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "structured" JSONB,
    "model" TEXT,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlTitleHistory" (
    "id" TEXT NOT NULL,
    "crawlId" TEXT,
    "crawlName" TEXT NOT NULL,
    "seed" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "metaDescription" TEXT NOT NULL DEFAULT '',
    "ts" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrawlTitleHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRun" (
    "id" TEXT NOT NULL,
    "sourceDir" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "stats" JSONB,
    "errors" JSONB,
    "log" JSONB,

    CONSTRAINT "ImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Project_ownerId_idx" ON "Project"("ownerId");

-- CreateIndex
CREATE INDEX "Website_host_idx" ON "Website"("host");

-- CreateIndex
CREATE UNIQUE INDEX "Website_projectId_host_key" ON "Website"("projectId", "host");

-- CreateIndex
CREATE UNIQUE INDEX "CrawlJob_legacyFile_key" ON "CrawlJob"("legacyFile");

-- CreateIndex
CREATE INDEX "CrawlJob_projectId_createdAt_idx" ON "CrawlJob"("projectId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "CrawlJob_websiteId_finishedAt_idx" ON "CrawlJob"("websiteId", "finishedAt");

-- CreateIndex
CREATE INDEX "CrawlJob_status_idx" ON "CrawlJob"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CrawlConfiguration_crawlId_key" ON "CrawlConfiguration"("crawlId");

-- CreateIndex
CREATE INDEX "CrawledPage_crawlId_seoScore_idx" ON "CrawledPage"("crawlId", "seoScore");

-- CreateIndex
CREATE INDEX "CrawledPage_crawlId_statusCode_idx" ON "CrawledPage"("crawlId", "statusCode");

-- CreateIndex
CREATE INDEX "CrawledPage_crawlId_position_idx" ON "CrawledPage"("crawlId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "CrawledPage_crawlId_url_key" ON "CrawledPage"("crawlId", "url");

-- CreateIndex
CREATE INDEX "PageIssue_crawlId_groupLabel_idx" ON "PageIssue"("crawlId", "groupLabel");

-- CreateIndex
CREATE INDEX "PageIssue_crawlId_severity_idx" ON "PageIssue"("crawlId", "severity");

-- CreateIndex
CREATE INDEX "PageIssue_pageId_idx" ON "PageIssue"("pageId");

-- CreateIndex
CREATE UNIQUE INDEX "CrawlReport_crawlId_key_key" ON "CrawlReport"("crawlId", "key");

-- CreateIndex
CREATE INDEX "CrawlInlink_crawlId_targetUrl_idx" ON "CrawlInlink"("crawlId", "targetUrl");

-- CreateIndex
CREATE INDEX "CrawlInlink_crawlId_sourceUrl_idx" ON "CrawlInlink"("crawlId", "sourceUrl");

-- CreateIndex
CREATE UNIQUE INDEX "SeoScore_crawlId_key" ON "SeoScore"("crawlId");

-- CreateIndex
CREATE INDEX "SeoCategoryScore_crawlId_scope_category_idx" ON "SeoCategoryScore"("crawlId", "scope", "category");

-- CreateIndex
CREATE INDEX "SeoCategoryScore_pageId_idx" ON "SeoCategoryScore"("pageId");

-- CreateIndex
CREATE UNIQUE INDEX "CrawlComparison_baseCrawlId_targetCrawlId_algorithmVersion_key" ON "CrawlComparison"("baseCrawlId", "targetCrawlId", "algorithmVersion");

-- CreateIndex
CREATE INDEX "AiConversation_crawlRef_updatedAt_idx" ON "AiConversation"("crawlRef", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "AiConversation_crawlId_idx" ON "AiConversation"("crawlId");

-- CreateIndex
CREATE INDEX "AiMessage_conversationId_id_idx" ON "AiMessage"("conversationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AiMessage_conversationId_legacyId_key" ON "AiMessage"("conversationId", "legacyId");

-- CreateIndex
CREATE INDEX "CrawlTitleHistory_url_ts_idx" ON "CrawlTitleHistory"("url", "ts");

-- CreateIndex
CREATE UNIQUE INDEX "CrawlTitleHistory_crawlName_url_ts_key" ON "CrawlTitleHistory"("crawlName", "url", "ts");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreference_userId_key_key" ON "UserPreference"("userId", "key");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Website" ADD CONSTRAINT "Website_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlJob" ADD CONSTRAINT "CrawlJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlJob" ADD CONSTRAINT "CrawlJob_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlConfiguration" ADD CONSTRAINT "CrawlConfiguration_crawlId_fkey" FOREIGN KEY ("crawlId") REFERENCES "CrawlJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawledPage" ADD CONSTRAINT "CrawledPage_crawlId_fkey" FOREIGN KEY ("crawlId") REFERENCES "CrawlJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageIssue" ADD CONSTRAINT "PageIssue_crawlId_fkey" FOREIGN KEY ("crawlId") REFERENCES "CrawlJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageIssue" ADD CONSTRAINT "PageIssue_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "CrawledPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlReport" ADD CONSTRAINT "CrawlReport_crawlId_fkey" FOREIGN KEY ("crawlId") REFERENCES "CrawlJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlInlink" ADD CONSTRAINT "CrawlInlink_crawlId_fkey" FOREIGN KEY ("crawlId") REFERENCES "CrawlJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoScore" ADD CONSTRAINT "SeoScore_crawlId_fkey" FOREIGN KEY ("crawlId") REFERENCES "CrawlJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoCategoryScore" ADD CONSTRAINT "SeoCategoryScore_crawlId_fkey" FOREIGN KEY ("crawlId") REFERENCES "CrawlJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoCategoryScore" ADD CONSTRAINT "SeoCategoryScore_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "CrawledPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlComparison" ADD CONSTRAINT "CrawlComparison_baseCrawlId_fkey" FOREIGN KEY ("baseCrawlId") REFERENCES "CrawlJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlComparison" ADD CONSTRAINT "CrawlComparison_targetCrawlId_fkey" FOREIGN KEY ("targetCrawlId") REFERENCES "CrawlJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_crawlId_fkey" FOREIGN KEY ("crawlId") REFERENCES "CrawlJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlTitleHistory" ADD CONSTRAINT "CrawlTitleHistory_crawlId_fkey" FOREIGN KEY ("crawlId") REFERENCES "CrawlJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

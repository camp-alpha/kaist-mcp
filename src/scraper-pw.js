#!/usr/bin/env node

/**
 * KAIST Scraper v3 — Playwright 기반
 * JS 렌더링 페이지 대응 (물리학과, 전산학부 상세)
 */

import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, "..", "data", "kaist.json");

let browser;

async function init() {
  browser = await chromium.launch({ headless: true });
}

async function getPage(url, waitFor = 5000) {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "commit", timeout: 30000 });
    // 리다이렉트 안정화 대기
    await page.waitForTimeout(waitFor);
    try { await page.waitForLoadState("domcontentloaded", { timeout: 10000 }); } catch {}
    await page.waitForTimeout(1000);
    return page;
  } catch (e) {
    console.error(`  Page load failed: ${url} — ${e.message}`);
    await page.close();
    return null;
  }
}

// ── 전산학부 ──
async function scrapeCS() {
  console.log("\n=== 전산학부 ===");
  const page = await getPage("https://cs.kaist.ac.kr/people/faculty");
  if (!page) return [];

  const professors = await page.evaluate(() => {
    const items = document.querySelectorAll("li.horiz_item");
    const results = [];
    items.forEach(el => {
      const text = el.textContent.replace(/\s+/g, " ").trim();
      const nameKo = text.match(/^([가-힣]{2,4})/);
      if (!nameKo) return;

      // 이메일
      const emailEl = el.querySelector("script");
      let email = "";
      if (emailEl) {
        const m = emailEl.textContent.match(/emailWrite\('([^']+)'\)/);
        if (m) email = m[1].replace("^*", "@");
      }

      // 연구 분야 (ext 뒤)
      const parts = text.split(/\d{4}\s*/);
      const research = parts.length > 1
        ? parts[parts.length - 1].split(/[,،·]/).map(s => s.trim()).filter(s => s.length > 1)
        : [];

      // 연구실
      const labMatch = text.match(/연구실:\s*([^e\n]+?)(?:\s*email|$)/);

      // 상세 링크
      const link = el.querySelector("a[href*='view']");
      const href = link ? link.getAttribute("href") : "";

      // 이미지에서 연구실 URL
      const img = el.querySelector("img");
      const imgAlt = img ? img.getAttribute("alt") : "";

      results.push({
        name_ko: nameKo[1],
        email,
        research_areas: research,
        lab: labMatch ? labMatch[1].trim() : "",
        url: href ? `https://cs.kaist.ac.kr${href}` : "",
      });
    });
    return results;
  });

  // 각 교수 상세 페이지에서 연구실 홈페이지 + 논문 수집
  for (let i = 0; i < professors.length; i++) {
    const prof = professors[i];
    if (!prof.url || !prof.url.includes("idx=")) continue;

    if (i % 20 === 0) console.log(`  Detail: ${i}/${professors.length}`);

    const detailPage = await getPage(prof.url, 2000);
    if (!detailPage) continue;

    const detail = await detailPage.evaluate(() => {
      const links = [...document.querySelectorAll("a[href]")];
      let labUrl = "";
      for (const a of links) {
        const href = a.getAttribute("href") || "";
        const text = a.textContent.toLowerCase();
        if (href.startsWith("http") && !href.includes("kaist.ac.kr/people") &&
            (text.includes("lab") || text.includes("homepage") || text.includes("홈페이지") ||
             href.includes("lab") || href.includes("~"))) {
          labUrl = href;
          break;
        }
      }

      // 논문
      const papers = [];
      document.querySelectorAll("li, .publication, p").forEach(el => {
        const t = el.textContent.trim();
        if (/20[12]\d/.test(t) && t.length > 50 && t.length < 500 &&
            (t.includes("IEEE") || t.includes("ACM") || t.includes("Conf") ||
             t.includes("Journal") || t.includes("arXiv") || t.includes("Proc"))) {
          papers.push(t.replace(/\s+/g, " ").slice(0, 200));
        }
      });

      // 영문 이름
      const nameEn = document.body.textContent.match(/([A-Z][a-z]+(?:[-\s][A-Z][a-z-]+){1,3})/);

      return { labUrl, papers: papers.slice(0, 5), nameEn: nameEn ? nameEn[0] : "" };
    });

    prof.lab_url = detail.labUrl;
    prof.recent_papers = detail.papers;
    prof.name_en = detail.nameEn;
    await detailPage.close();
    await new Promise(r => setTimeout(r, 200));
  }

  await page.close();

  const result = professors.map(p => ({
    name_ko: p.name_ko,
    name_en: p.name_en || "",
    department: "전산학부",
    department_id: "cs",
    position: "교수",
    email: p.email,
    url: p.url,
    lab_url: p.lab_url || "",
    research_areas: p.research_areas,
    keywords: [],
    lab: p.lab,
    recent_papers: p.recent_papers || [],
  }));

  console.log(`  전산학부: ${result.length}명 (${result.filter(p => p.lab_url).length} lab URLs)`);
  return result;
}

// ── 물리학과 ──
async function scrapePhysics() {
  console.log("\n=== 물리학과 ===");
  const page = await getPage("https://physics.kaist.ac.kr/index.php?mid=p_people1&category=193", 5000);
  if (!page) return [];

  const professors = await page.evaluate(() => {
    const results = [];
    // XE 게시판: .document_item, .board_list, table 등
    const items = document.querySelectorAll(".document_item, .board_list tr, .xe_content .item, table.faculty tr, .list_item");

    if (items.length > 0) {
      items.forEach(el => {
        const text = el.textContent.replace(/\s+/g, " ").trim();
        const nameKo = text.match(/([가-힣]{2,4})/);
        const nameEn = text.match(/([A-Z][a-z]+(?:[-\s][A-Z][a-z-]+)+)/);
        if (nameKo && text.length < 500) {
          const emailMatch = text.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+)/);
          const link = el.querySelector("a[href]");
          results.push({
            name_ko: nameKo[1],
            name_en: nameEn ? nameEn[0] : "",
            email: emailMatch ? emailMatch[1] : "",
            url: link ? link.getAttribute("href") : "",
          });
        }
      });
    }

    // 폴백: 이미지 기반 (교수 사진 카드)
    if (results.length === 0) {
      const cards = document.querySelectorAll("[class*='prof'], [class*='people'], [class*='member'], [class*='faculty']");
      cards.forEach(el => {
        const text = el.textContent.replace(/\s+/g, " ").trim();
        const nameKo = text.match(/([가-힣]{2,4})/);
        if (nameKo && text.length < 300) {
          results.push({
            name_ko: nameKo[1],
            name_en: "",
            email: "",
            url: "",
          });
        }
      });
    }

    // 폴백2: 전체 텍스트
    if (results.length === 0) {
      const bodyText = document.body.textContent;
      const matches = bodyText.matchAll(/([가-힣]{2,4})\s*[\(（]\s*([A-Z][a-z]+(?:[\s-][A-Z][a-z-]+)+)\s*[\)）]/g);
      for (const m of matches) {
        results.push({ name_ko: m[1], name_en: m[2], email: "", url: "" });
      }
    }

    return results;
  });

  await page.close();

  // 필터
  const menuWords = new Set(["교수진", "구성원", "공지사항", "교수초빙", "연구", "교육", "뉴스", "동문", "행정", "학과"]);
  const filtered = professors.filter(p => !menuWords.has(p.name_ko) && p.name_ko.length >= 2);
  const unique = [...new Map(filtered.map(p => [p.name_ko, p])).values()];

  const result = unique.map(p => ({
    name_ko: p.name_ko,
    name_en: p.name_en || "",
    department: "물리학과",
    department_id: "physics",
    position: "교수",
    email: p.email || "",
    url: p.url || "",
    lab_url: "",
    research_areas: [],
    keywords: [],
    lab: "",
    recent_papers: [],
  }));

  console.log(`  물리학과: ${result.length}명`);
  return result;
}

// ── 수리과학과 ──
async function scrapeMath() {
  console.log("\n=== 수리과학과 ===");
  const page = await getPage("https://mathsci.kaist.ac.kr/home/people/professor/", 3000);
  if (!page) return [];

  const professors = await page.evaluate(() => {
    const results = [];
    const bodyText = document.body.textContent;
    const menuWords = ["교수", "연구분야", "학사일정", "정보보안", "응용수학", "수학그룹", "뉴스", "소개", "공지", "직원", "학과", "연수"];

    const matches = bodyText.matchAll(/([가-힣]{2,4})\s*[\(（]\s*([A-Za-z]+(?:[\s,.-]+[A-Za-z]+)*)\s*[\)）]/g);
    for (const m of matches) {
      const nameKo = m[1];
      const nameEn = m[2].trim();
      if (menuWords.includes(nameKo)) continue;
      if (nameKo.length < 2 || nameEn.length < 3) continue;
      if (/University|Institute|College|School/i.test(nameEn)) continue;
      results.push({ name_ko: nameKo, name_en: nameEn });
    }

    // 링크 수집
    const links = {};
    document.querySelectorAll("a[href]").forEach(a => {
      const href = a.getAttribute("href") || "";
      const text = a.textContent.trim();
      const nameMatch = text.match(/([가-힣]{2,4})/);
      if (nameMatch && href.startsWith("http")) {
        links[nameMatch[1]] = href;
      }
    });

    return results.map(r => ({
      ...r,
      url: links[r.name_ko] || "",
      lab_url: (links[r.name_ko] || "").includes("lab") || (links[r.name_ko] || "").includes("~")
        ? links[r.name_ko] : "",
    }));
  });

  await page.close();

  const unique = [...new Map(professors.map(p => [p.name_ko, p])).values()];
  const result = unique.map(p => ({
    name_ko: p.name_ko,
    name_en: p.name_en,
    department: "수리과학과",
    department_id: "math",
    position: "교수",
    email: "",
    url: p.url,
    lab_url: p.lab_url || "",
    research_areas: [],
    keywords: [],
    lab: "",
    recent_papers: [],
  }));

  console.log(`  수리과학과: ${result.length}명`);
  return result;
}

// ── 메인 ──
async function main() {
  console.log("KAIST MCP Scraper v3 (Playwright)\n");

  await init();

  const cs = await scrapeCS();
  const physics = await scrapePhysics();
  const math = await scrapeMath();

  await browser.close();

  const allProfessors = [...cs, ...physics, ...math];

  const data = {
    meta: {
      university: "KAIST",
      scraped_at: new Date().toISOString(),
      scraper: "playwright-v3",
      total_professors: allProfessors.length,
    },
    departments: [
      { id: "cs", name_ko: "전산학부", name_en: "School of Computing", professor_count: cs.length },
      { id: "physics", name_ko: "물리학과", name_en: "Department of Physics", professor_count: physics.length },
      { id: "math", name_ko: "수리과학과", name_en: "Department of Mathematical Sciences", professor_count: math.length },
    ],
    professors: allProfessors,
    labs: [],
  };

  mkdirSync(join(__dirname, "..", "data"), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(data, null, 2));

  const stats = {
    total: allProfessors.length,
    withUrl: allProfessors.filter(p => p.url).length,
    withLabUrl: allProfessors.filter(p => p.lab_url).length,
    withPapers: allProfessors.filter(p => p.recent_papers?.length > 0).length,
    withEmail: allProfessors.filter(p => p.email).length,
  };

  console.log(`\n=== 결과 ===`);
  console.log(`Total: ${stats.total} (CS:${cs.length} Physics:${physics.length} Math:${math.length})`);
  console.log(`URLs: ${stats.withUrl} | Lab URLs: ${stats.withLabUrl} | Emails: ${stats.withEmail} | Papers: ${stats.withPapers}`);
  console.log(`Saved: ${OUT_PATH}`);
}

main().catch(console.error);

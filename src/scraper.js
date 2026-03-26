#!/usr/bin/env node

/**
 * KAIST 학과별 교수/연구실 정보 스크래핑
 *
 * 대상: 물리학과, 전산학부, 수리과학과
 * 출력: data/kaist.json
 */

import { writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, "..", "data", "kaist.json");

// KAIST 학과 페이지 URL
const DEPARTMENTS = [
  {
    id: "physics",
    name_ko: "물리학과",
    name_en: "Department of Physics",
    faculty_url: "https://physics.kaist.ac.kr/eng/people/faculty",
    base_url: "https://physics.kaist.ac.kr",
  },
  {
    id: "cs",
    name_ko: "전산학부",
    name_en: "School of Computing",
    faculty_url: "https://cs.kaist.ac.kr/people/faculty",
    base_url: "https://cs.kaist.ac.kr",
  },
  {
    id: "math",
    name_ko: "수리과학과",
    name_en: "Department of Mathematical Sciences",
    faculty_url: "https://mathsci.kaist.ac.kr/home/people/professor/",
    base_url: "https://mathsci.kaist.ac.kr",
  },
];

async function fetchHTML(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; KaistMCP/0.1; research-tool)",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    console.error(`  Fetch failed: ${url} — ${e.message}`);
    return null;
  }
}

async function parseWithCheerio(html) {
  const { load } = await import("cheerio");
  return load(html);
}

async function scrapeDepartment(dept) {
  console.log(`Scraping: ${dept.name_ko} (${dept.faculty_url})`);
  const html = await fetchHTML(dept.faculty_url);
  if (!html) return { professors: [], labs: [] };

  const $ = await parseWithCheerio(html);
  const professors = [];
  const labs = [];

  // 일반적인 KAIST 학과 페이지 패턴 파싱
  // 교수 카드/리스트 항목 찾기 (여러 패턴 시도)
  const selectors = [
    ".professor-list .item, .faculty-list .item, .people-list .item",
    ".prof-card, .faculty-card, .member-card",
    "table.faculty tbody tr, table.professor tbody tr",
    ".view-content .views-row",
    "article.professor, article.faculty",
    ".professor-wrap, .faculty-wrap",
    "li.professor, li.faculty",
  ];

  let found = false;
  for (const sel of selectors) {
    const items = $(sel);
    if (items.length > 0) {
      console.log(`  Found ${items.length} items with selector: ${sel}`);
      items.each((_, el) => {
        const $el = $(el);
        const text = $el.text().replace(/\s+/g, " ").trim();

        // 이름 추출 (한글)
        const nameMatch = text.match(/([가-힣]{2,4})/);
        const nameEn = text.match(/([A-Z][a-z]+ [A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/);

        // 연구 분야 추출
        const researchText = $el.find(".research, .field, .area, .interest").text().trim();

        // 이메일
        const emailMatch = text.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+)/);

        // 링크
        const link = $el.find("a").first().attr("href");
        const url = link ? (link.startsWith("http") ? link : `${dept.base_url}${link}`) : "";

        if (nameMatch) {
          const prof = {
            name_ko: nameMatch[1],
            name_en: nameEn ? nameEn[1] : "",
            department: dept.name_ko,
            department_id: dept.id,
            position: "교수",
            email: emailMatch ? emailMatch[1] : "",
            url: url,
            research_areas: researchText ? researchText.split(/[,;·]/g).map(s => s.trim()).filter(Boolean) : [],
            keywords: [],
            lab: "",
            recent_papers: [],
          };
          professors.push(prof);
        }
      });
      found = true;
      break;
    }
  }

  if (!found) {
    // 폴백: 페이지 전체 텍스트에서 한글 이름 + 영문 이름 패턴 추출
    console.log("  Fallback: extracting names from page text");
    const bodyText = $("body").text();
    const nameBlocks = bodyText.match(/([가-힣]{2,4})\s*[(\[]?\s*([A-Z][a-z]+(?:\s[A-Z][a-z-]+)+)\s*[)\]]?/g) || [];

    for (const block of nameBlocks) {
      const ko = block.match(/([가-힣]{2,4})/);
      const en = block.match(/([A-Z][a-z]+(?:\s[A-Z][a-z-]+)+)/);
      if (ko && en) {
        professors.push({
          name_ko: ko[1],
          name_en: en[1],
          department: dept.name_ko,
          department_id: dept.id,
          position: "교수",
          email: "",
          url: dept.faculty_url,
          research_areas: [],
          keywords: [],
          lab: "",
          recent_papers: [],
        });
      }
    }
  }

  // 중복 제거
  const seen = new Set();
  const unique = professors.filter(p => {
    const key = p.name_ko + p.department;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`  Result: ${unique.length} professors`);
  return { professors: unique, labs };
}

async function main() {
  console.log("KAIST MCP Data Scraper\n");

  const allProfessors = [];
  const allLabs = [];
  const deptSummaries = [];

  for (const dept of DEPARTMENTS) {
    const result = await scrapeDepartment(dept);
    allProfessors.push(...result.professors);
    allLabs.push(...result.labs);
    deptSummaries.push({
      ...dept,
      professor_count: result.professors.length,
    });
  }

  const data = {
    meta: {
      university: "KAIST",
      scraped_at: new Date().toISOString(),
      total_professors: allProfessors.length,
      total_labs: allLabs.length,
    },
    departments: deptSummaries,
    professors: allProfessors,
    labs: allLabs,
  };

  mkdirSync(join(__dirname, "..", "data"), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(data, null, 2));
  console.log(`\nSaved: ${OUT_PATH}`);
  console.log(`Total: ${allProfessors.length} professors, ${allLabs.length} labs`);
}

main().catch(console.error);

import * as cheerio from "cheerio";

const URLS = [
  ["physics", "https://physics.kaist.ac.kr/eng/people/faculty"],
  ["cs", "https://cs.kaist.ac.kr/people/faculty"],
  ["math", "https://mathsci.kaist.ac.kr/home/people/professor/"],
];

for (const [dept, url] of URLS) {
  console.log(`\n=== ${dept} (${url}) ===`);
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    const html = await res.text();
    const $ = cheerio.load(html);

    // 교수 사진/카드 찾기
    const profDivs = [];
    $("div[class], li[class], article[class], tr").each((_, el) => {
      const cls = $(el).attr("class") || "";
      const text = $(el).text().replace(/\s+/g, " ").trim();
      // 한글 이름 + 영문 이름이 동시에 있는 요소
      if (/[가-힣]{2,4}/.test(text) && /[A-Z][a-z]+ [A-Z]/.test(text) && text.length < 500) {
        profDivs.push({ tag: el.tagName, cls: cls.slice(0, 40), text: text.slice(0, 200) });
      }
    });
    console.log(`  Prof-like elements: ${profDivs.length}`);
    for (const p of profDivs.slice(0, 5)) {
      console.log(`    [${p.tag}.${p.cls}] ${p.text}`);
    }

    // a 태그에서 교수 상세 링크 패턴
    const profLinks = [];
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") || "";
      const text = $(el).text().trim();
      if ((href.includes("people") || href.includes("professor") || href.includes("faculty")) && /[가-힣]{2,4}/.test(text)) {
        profLinks.push({ href: href.slice(0, 80), text: text.slice(0, 60) });
      }
    });
    console.log(`  Prof links: ${profLinks.length}`);
    for (const l of profLinks.slice(0, 5)) {
      console.log(`    ${l.text} → ${l.href}`);
    }

  } catch (e) {
    console.log(`  Error: ${e.message}`);
  }
}

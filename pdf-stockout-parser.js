(function registerStockoutPdfParser(root, factory) {
  const parser = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = parser;
  root.StockoutPdfParser = parser;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const LEGACY_STOP_RE = /(기본|기존|추가|프로모션|기간|대상|수수료|요율|전략|지급|신규|매출|처방시)/;
  const RELEASE_RE = /(입고\s*완료|품절\s*해제)/;

  function cleanText(value) {
    return String(value ?? "").replace(/\u00a0/g, " ").trim().replace(/\s+/g, " ");
  }

  function groupFragments(fragments) {
    const rows = [];
    const sorted = fragments
      .map((item) => ({ text: cleanText(item.text), x: Number(item.x), y: Number(item.y) }))
      .filter((item) => item.text && Number.isFinite(item.x) && Number.isFinite(item.y) && item.y > 0)
      .sort((a, b) => b.y - a.y || a.x - b.x);

    for (const fragment of sorted) {
      const last = rows[rows.length - 1];
      if (!last || Math.abs(last[0].y - fragment.y) > 3) rows.push([fragment]);
      else last.push(fragment);
    }
    return rows;
  }

  function columnText(row, minX, maxX = Infinity) {
    return row
      .filter((item) => item.x >= minX && item.x < maxX)
      .map((item) => item.text)
      .join(" ")
      .trim();
  }

  function distributionRow(row) {
    return {
      company: columnText(row, 0, 70),
      productName: columnText(row, 70, 315),
      expectedDate: columnText(row, 315),
      note: "",
    };
  }

  function rowText(row) {
    return row.map((item) => item.text).join(" ").trim();
  }

  function averageY(row, minX, maxX = Infinity) {
    const items = row.filter((item) => item.x >= minX && item.x < maxX);
    if (!items.length) return row.reduce((sum, item) => sum + item.y, 0) / Math.max(row.length, 1);
    return items.reduce((sum, item) => sum + item.y, 0) / items.length;
  }

  function isDistributionNoticePage(rows) {
    const combined = rows.map(rowText).join(" ");
    if (/프로모션\s*공지|내용/.test(combined) && !/출하\s*예정일|입고\s*예정일/.test(combined)) return false;
    return /품절\s*공지|출하\s*예정일|입고\s*예정일/.test(combined);
  }

  function isDistributionHeader(combined) {
    if (/품절\s*공지|공지사항|유통현황|제약사명/.test(combined)) return true;
    return combined.includes("제품명") && (/출하\s*예정일|입고\s*예정일|내용/.test(combined));
  }

  function productPosition(productRows, y) {
    if (!productRows.length) return 0;
    if (y >= productRows[0].y) return 0;
    if (y <= productRows[productRows.length - 1].y) return productRows.length - 1;

    for (let index = 0; index < productRows.length - 1; index += 1) {
      const current = productRows[index].y;
      const next = productRows[index + 1].y;
      if (current >= y && y >= next) {
        const span = current - next;
        return span ? index + (current - y) / span : index;
      }
    }
    return productRows.length - 1;
  }

  function detectLayout(pages) {
    let distributionRows = 0;
    let legacyHeaders = 0;

    for (const rows of pages) {
      for (const row of rows) {
        const combined = row.map((item) => item.text).join(" ");
        if (combined.includes("입고 예정일") || (combined.includes("제품명") && combined.includes("비고"))) {
          distributionRows += 5;
        }
        if (combined.includes("제약사명") && (combined.includes("출하") || combined.includes("제품명"))) {
          legacyHeaders += 1;
        }

        const parsed = distributionRow(row);
        if (parsed.company && parsed.productName && parsed.expectedDate) distributionRows += 1;
      }
    }

    return distributionRows >= 3 && distributionRows > legacyHeaders * 2 ? "distribution" : "legacy";
  }

  function parseDistributionPages(pages) {
    const items = [];
    for (const rows of pages) {
      if (!isDistributionNoticePage(rows)) continue;

      const productRows = [];
      const companyAnchors = [];
      for (const row of rows) {
        const parsed = distributionRow(row);
        const combined = rowText(row);
        if (isDistributionHeader(combined)) continue;

        if (/^[\(（]/.test(parsed.company) && companyAnchors.length && !parsed.productName) {
          const lastAnchor = companyAnchors[companyAnchors.length - 1];
          lastAnchor.company = cleanText(`${lastAnchor.company} ${parsed.company}`);
          continue;
        }

        if (parsed.company) {
          companyAnchors.push({
            company: parsed.company,
            y: averageY(row, 0, 70),
            position: 0,
          });
        }

        if (!parsed.productName || !parsed.expectedDate) continue;
        if (RELEASE_RE.test(parsed.expectedDate)) continue;

        productRows.push({
          productName: parsed.productName,
          expectedDate: parsed.expectedDate || "-",
          y: averageY(row, 70),
        });
      }

      if (!productRows.length) continue;

      companyAnchors.forEach((anchor) => {
        anchor.position = productPosition(productRows, anchor.y);
      });

      if (!companyAnchors.length) {
        items.push(...productRows.map((row) => ({ company: "", productName: row.productName, expectedDate: row.expectedDate })));
        continue;
      }

      let startIndex = 0;
      for (let anchorIndex = 0; anchorIndex < companyAnchors.length; anchorIndex += 1) {
        const anchor = companyAnchors[anchorIndex];
        const nextAnchor = companyAnchors[anchorIndex + 1];
        const estimatedEnd = nextAnchor ? Math.round(anchor.position * 2 - startIndex) : productRows.length - 1;
        const nextLimit = nextAnchor ? Math.floor(nextAnchor.position) : productRows.length - 1;
        const endIndex = Math.max(startIndex, Math.min(estimatedEnd, nextLimit, productRows.length - 1));

        for (let rowIndex = startIndex; rowIndex <= endIndex; rowIndex += 1) {
          const productRow = productRows[rowIndex];
          items.push({
            company: anchor.company,
            productName: productRow.productName,
            expectedDate: productRow.expectedDate,
          });
        }
        startIndex = endIndex + 1;
      }

      if (startIndex < productRows.length) {
        const company = companyAnchors[companyAnchors.length - 1].company;
        for (let rowIndex = startIndex; rowIndex < productRows.length; rowIndex += 1) {
          const productRow = productRows[rowIndex];
          items.push({
            company,
            productName: productRow.productName,
            expectedDate: productRow.expectedDate,
          });
        }
      }
    }
    return items;
  }

  function parseLegacyPages(pages) {
    const items = [];
    for (const rows of pages) {
      let started = false;
      let currentCompany = "";
      const pendingCompanyItems = [];

      for (const row of rows) {
        const combined = row.map((item) => item.text).join(" ");
        if (combined.includes("제약사명") && (combined.includes("제품명") || combined.includes("출하"))) {
          started = true;
          continue;
        }
        if (!started) continue;

        const company = columnText(row, 0, 70);
        const productName = columnText(row, 70, 335);
        const expectedDate = columnText(row, 335);
        if (LEGACY_STOP_RE.test(`${productName} ${expectedDate}`)) break;
        if (["제품명", "내용", "출하 예정일"].includes(productName)) continue;

        if (company) {
          if (!currentCompany) {
            pendingCompanyItems.forEach((item) => {
              item.company = company;
            });
            pendingCompanyItems.length = 0;
          }
          currentCompany = company;
        }

        if (!productName) continue;

        const item = {
          company: company || currentCompany,
          productName,
          expectedDate: expectedDate || "-",
        };
        items.push(item);
        if (!item.company) pendingCompanyItems.push(item);
      }
    }
    return items;
  }

  function parsePages(pageFragments) {
    const pages = pageFragments.map(groupFragments);
    const layout = detectLayout(pages);
    const items = layout === "distribution" ? parseDistributionPages(pages) : parseLegacyPages(pages);
    return {
      layout,
      layoutLabel: layout === "distribution" ? "제약사별 유통현황 형식" : "기존 품절리스트 형식",
      items,
    };
  }

  return {
    detectLayout,
    groupFragments,
    parseDistributionPages,
    parseLegacyPages,
    parsePages,
  };
});

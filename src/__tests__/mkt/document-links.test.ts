import { describe, expect, it } from "vitest";
import { parseDocumentLink, buildDocumentUrls } from "@/lib/mkt/document-links";

describe("parseDocumentLink", () => {
  it("Google Sheets → gsheet, xem trực tiếp qua /preview", () => {
    const r = parseDocumentLink(
      "https://docs.google.com/spreadsheets/d/1A_bC-9x/edit#gid=0",
    );
    expect(r.sourceType).toBe("gsheet");
    expect(r.externalId).toBe("1A_bC-9x");
    expect(r.embedUrl).toBe("https://docs.google.com/spreadsheets/d/1A_bC-9x/preview");
    expect(r.canPreview).toBe(true);
  });

  it("Google Docs → gdoc; Google Slides → gslide", () => {
    expect(parseDocumentLink("https://docs.google.com/document/d/DOC1/edit").sourceType).toBe("gdoc");
    expect(parseDocumentLink("https://docs.google.com/presentation/d/SL1/edit").sourceType).toBe(
      "gslide",
    );
  });

  it("Google Drive file (pdf/office bất kỳ) → drive, có thumbnail", () => {
    const r = parseDocumentLink("https://drive.google.com/file/d/FILE_9/view?usp=sharing");
    expect(r.sourceType).toBe("drive");
    expect(r.externalId).toBe("FILE_9");
    expect(r.embedUrl).toBe("https://drive.google.com/file/d/FILE_9/preview");
    expect(r.thumbnailUrl).toContain("thumbnail?id=FILE_9");
  });

  it("PDF trực tiếp → pdf, nhúng thẳng URL", () => {
    const r = parseDocumentLink("https://example.com/tai-lieu/bao-gia.pdf");
    expect(r.sourceType).toBe("pdf");
    expect(r.embedUrl).toBe("https://example.com/tai-lieu/bao-gia.pdf");
    expect(r.canPreview).toBe(true);
  });

  it("File Office công khai (.xlsx/.docx) → office_link, bọc Office viewer", () => {
    const r = parseDocumentLink("https://example.com/files/bang-gia.xlsx");
    expect(r.sourceType).toBe("office_link");
    expect(r.embedUrl).toContain("view.officeapps.live.com/op/view.aspx?src=");
    expect(r.embedUrl).toContain(encodeURIComponent("https://example.com/files/bang-gia.xlsx"));
    expect(parseDocumentLink("https://x.com/a.docx").sourceType).toBe("office_link");
  });

  it("OneDrive embed → xem trực tiếp; share thường → không", () => {
    expect(
      parseDocumentLink("https://onedrive.live.com/embed?cid=A&resid=A%21123").canPreview,
    ).toBe(true);
    const share = parseDocumentLink("https://1drv.ms/x/s!AbC");
    expect(share.sourceType).toBe("onedrive");
    expect(share.canPreview).toBe(false);
  });

  it("dán nguyên mã <iframe> → tự rút src", () => {
    const r = parseDocumentLink(
      '<iframe src="https://docs.google.com/spreadsheets/d/EMB1/preview"></iframe>',
    );
    expect(r.sourceType).toBe("gsheet");
    expect(r.externalId).toBe("EMB1");
  });

  it("link lạ → other, không xem trực tiếp", () => {
    const r = parseDocumentLink("https://example.com/trang-bai-viet");
    expect(r.sourceType).toBe("other");
    expect(r.embedUrl).toBeNull();
    expect(r.canPreview).toBe(false);
  });
});

describe("buildDocumentUrls", () => {
  it("dựng lại embed từ dữ liệu DB (Google)", () => {
    expect(buildDocumentUrls("drive", "ID1", null).embedUrl).toContain("/file/d/ID1/preview");
    expect(buildDocumentUrls("gsheet", "S1", null).embedUrl).toContain("/spreadsheets/d/S1/preview");
    expect(buildDocumentUrls("gdoc", "D1", null).embedUrl).toContain("/document/d/D1/preview");
    expect(buildDocumentUrls("gslide", "P1", null).embedUrl).toContain("/presentation/d/P1/preview");
  });

  it("dựng lại pdf/office từ external_url", () => {
    expect(buildDocumentUrls("pdf", null, "https://x.com/a.pdf").embedUrl).toBe(
      "https://x.com/a.pdf",
    );
    const office = buildDocumentUrls("office_link", null, "https://x.com/a.xlsx");
    expect(office.embedUrl).toContain("officeapps.live.com");
    expect(office.embedUrl).toContain(encodeURIComponent("https://x.com/a.xlsx"));
  });

  it("nguồn khác → không embed", () => {
    expect(buildDocumentUrls("other", null, "https://x.com/y").embedUrl).toBeNull();
  });
});

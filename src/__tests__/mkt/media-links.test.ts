import { describe, expect, it } from "vitest";
import { parseMediaLink, buildMediaUrls } from "@/lib/mkt/media-links";

describe("parseMediaLink", () => {
  it("nhận diện Google Drive /file/d/<ID>/view", () => {
    const r = parseMediaLink("https://drive.google.com/file/d/1AbC_x-9/view?usp=sharing");
    expect(r.sourceType).toBe("drive");
    expect(r.externalId).toBe("1AbC_x-9");
    expect(r.embedUrl).toBe("https://drive.google.com/file/d/1AbC_x-9/preview");
    expect(r.thumbnailUrl).toContain("thumbnail?id=1AbC_x-9");
  });

  it("nhận diện Drive open?id=", () => {
    const r = parseMediaLink("https://drive.google.com/open?id=XYZ123");
    expect(r.sourceType).toBe("drive");
    expect(r.externalId).toBe("XYZ123");
  });

  it("nhận diện YouTube watch + youtu.be + shorts", () => {
    expect(parseMediaLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ").externalId).toBe(
      "dQw4w9WgXcQ",
    );
    expect(parseMediaLink("https://youtu.be/dQw4w9WgXcQ").externalId).toBe("dQw4w9WgXcQ");
    const shorts = parseMediaLink("https://youtube.com/shorts/abc123XYZ_-");
    expect(shorts.sourceType).toBe("youtube");
    expect(shorts.embedUrl).toContain("youtube-nocookie.com/embed/");
    expect(shorts.thumbnailUrl).toContain("img.youtube.com");
  });

  it("nhận diện TikTok video", () => {
    const r = parseMediaLink("https://www.tiktok.com/@xuongcaphe/video/7300000000000000001");
    expect(r.sourceType).toBe("tiktok");
    expect(r.embedUrl).toBe("https://www.tiktok.com/player/v1/7300000000000000001");
  });

  it("OneDrive link embed → xem trực tiếp; link share thường → không", () => {
    const embed = parseMediaLink(
      "https://onedrive.live.com/embed?cid=ABC&resid=ABC%21123&authkey=xyz",
    );
    expect(embed.sourceType).toBe("onedrive");
    expect(embed.embedUrl).toContain("onedrive.live.com/embed");

    const share = parseMediaLink("https://1drv.ms/v/s!AbCdEf123");
    expect(share.sourceType).toBe("onedrive");
    expect(share.embedUrl).toBeNull();
  });

  it("dán nguyên mã <iframe> → tự rút src", () => {
    const r = parseMediaLink(
      '<iframe src="https://onedrive.live.com/embed?resid=A%21B&authkey=k" width="320"></iframe>',
    );
    expect(r.sourceType).toBe("onedrive");
    expect(r.embedUrl).toContain("onedrive.live.com/embed");
  });

  it("link ẢNH trực tiếp → image, xem trước bằng chính URL", () => {
    const r = parseMediaLink("https://cdn.example.com/anh/oolong.jpg?v=2");
    expect(r.sourceType).toBe("image");
    expect(r.kind).toBe("image");
    expect(r.embedUrl).toBe("https://cdn.example.com/anh/oolong.jpg?v=2");
    expect(r.thumbnailUrl).toBe("https://cdn.example.com/anh/oolong.jpg?v=2");
  });

  it("link VIDEO trực tiếp → video, phát bằng thẻ video", () => {
    const r = parseMediaLink("https://cdn.example.com/clip/quay.mp4");
    expect(r.sourceType).toBe("video");
    expect(r.kind).toBe("video");
    expect(r.embedUrl).toBe("https://cdn.example.com/clip/quay.mp4");
    expect(r.thumbnailUrl).toBeNull();
  });

  it("link lạ không phải media → other, không embed", () => {
    const r = parseMediaLink("https://example.com/bai-viet");
    expect(r.sourceType).toBe("other");
    expect(r.embedUrl).toBeNull();
  });
});

describe("buildMediaUrls", () => {
  it("dựng lại từ dữ liệu DB", () => {
    expect(buildMediaUrls("drive", "ID1", null).embedUrl).toContain("/file/d/ID1/preview");
    expect(buildMediaUrls("youtube", "vid", null).thumbnailUrl).toContain("img.youtube.com");
    expect(
      buildMediaUrls("onedrive", null, "https://onedrive.live.com/embed?resid=X").embedUrl,
    ).toContain("embed");
    expect(buildMediaUrls("onedrive", null, "https://1drv.ms/v/xxx").embedUrl).toBeNull();
    expect(buildMediaUrls("other", null, "https://x.com/bai-viet").embedUrl).toBeNull();
  });

  it("dựng lại ảnh/video trực tiếp từ external_url", () => {
    const img = buildMediaUrls("image", null, "https://x.com/a.png");
    expect(img.embedUrl).toBe("https://x.com/a.png");
    expect(img.thumbnailUrl).toBe("https://x.com/a.png");
    const vid = buildMediaUrls("video", null, "https://x.com/a.mp4");
    expect(vid.embedUrl).toBe("https://x.com/a.mp4");
    expect(vid.thumbnailUrl).toBeNull();
  });
});

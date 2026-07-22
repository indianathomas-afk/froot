// Client-side leg of the private HR upload (HR-3 pattern): get a presigned
// PUT URL, send the file straight to the Blob store (files over ~4.5 MB would
// 413 if sent through our API), and hand back the store's final URL for the
// registration POST. Shared by the library Add dialog, the HR-4 re-upload
// and signature flows, and the HR-6 training builder (which passes its own
// stricter upload-url endpoint).

export type HrBrowserUploadResult = { ok: true; url: string } | { ok: false; error: string }

export async function uploadHrFileFromBrowser(
  file: File,
  uploadUrlEndpoint = "/api/hr/documents/upload-url"
): Promise<HrBrowserUploadResult> {
  const urlRes = await fetch(uploadUrlEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, contentType: file.type, sizeBytes: file.size }),
  })
  const urlData = await urlRes.json().catch(() => ({}))
  if (!urlRes.ok) {
    return { ok: false, error: urlData.error ?? "Failed to start the upload" }
  }

  const putRes = await fetch(urlData.uploadUrl, {
    method: "PUT",
    headers: { "content-type": file.type },
    body: file,
  })
  // The PUT response is a PutBlobResult — its url (with the store's own
  // random suffix) is the real location; the presigned pathname is not.
  const blob = await putRes.json().catch(() => ({}))
  if (!putRes.ok || !blob.url) {
    return { ok: false, error: "The file upload failed — please try again" }
  }
  return { ok: true, url: blob.url }
}

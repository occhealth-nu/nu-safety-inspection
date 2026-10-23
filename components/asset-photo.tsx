"use client";
import { useState } from "react";
import { PhotoUploader, type UploadedPhoto } from "@/components/photo-uploader";

export function AssetPhotos({ assetId, initial, canEdit }: { assetId: string; initial: UploadedPhoto[]; canEdit: boolean }) {
  const [photos, setPhotos] = useState(initial);
  if (!canEdit && photos.length === 0) return <p className="text-sm text-gray-500">ยังไม่มีรูปภาพ</p>;
  return <PhotoUploader entityType="asset" entityId={assetId} kind="photo" photos={photos} disabled={!canEdit}
    onChange={setPhotos} label="เพิ่มรูป" />;
}

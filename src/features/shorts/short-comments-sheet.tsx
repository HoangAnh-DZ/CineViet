"use client";
import { MessageCircle } from "lucide-react";
import { Modal } from "@/components/ui";
export function ShortCommentsSheet({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Bình luận" onClose={onClose}>
      <div className="short-comments-empty">
        <MessageCircle size={32} />
        <h3>Chưa có bình luận</h3>
        <p>Bình luận đang được chuẩn bị. Thích và lưu chỉ áp dụng trong phiên xem này.</p>
      </div>
    </Modal>
  );
}

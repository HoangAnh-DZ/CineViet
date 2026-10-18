# Rewards tối giản, đổi thưởng và mua VIP trực tiếp

Ngày kiểm tra: 2026-10-09. Hoàn tất trong workspace và Neon QA; **chưa triển khai production**.

## Thay đổi

- `src/features/rewards/rewards-screen.tsx`: bỏ hai mô tả được chỉ định, CTA VIP trùng và nhiệm vụ chưa phát xu. Giữ thẻ xu vàng, cấp VIP, điểm danh, điều kiện nhận, lịch sử và năm tab. Hai CTA dẫn tới `/vip` và `/rewards/redeem`. Lịch sử xu hiển thị đúng dấu âm và tên đổi thưởng.
- `src/features/rewards/redemption-screen.tsx`, `src/app/rewards/redeem/page.tsx`, `src/app/api/rewards/redemptions/route.ts`, `src/server/redemption.ts`: form số xu/chủ tài khoản/số tài khoản/ngân hàng, số xu thực tế, khả dụng/đang giữ, tỷ lệ/phí/thực nhận và lịch sử riêng. Dùng denomination backend hiện có trong `src/domain/coins.ts`: 1 VND/xu; giới hạn rút hiện có 50.000–100.000.000 VND, phí 3.000 VND, tối đa năm yêu cầu đang chờ.
- `src/server/manual-money.ts`, `src/domain/money.ts`: tái sử dụng withdrawals với `source_asset=COIN`; giữ xu trong transaction khóa coin wallet, chống replay/đổi payload/chi vượt số khả dụng. Admin hoàn tất chỉ sau xác nhận đã chuyển khoản; trừ xu và ghi một coin ledger âm. Từ chối hoặc thất bại chỉ giải phóng khoản giữ đúng một lần. Không ghi cash ledger hay biến đổi ví VND khi đổi xu.
- `src/features/vip/vip-screen.tsx`, `src/features/vip/vip-checkout.tsx`, `src/app/vip/page.tsx`, `src/app/api/vip/purchases/route.ts`, `src/server/vip-purchases.ts`: mua trong modal của trang VIP hiện có, chuyển khoản đúng giá lấy từ DB, gửi bill qua dịch vụ upload hiện có và xem trạng thái. Không qua nạp ví và không cần số dư VND. Bill phải thuộc người gửi và chưa được dùng cho nạp/VIP khác.
- `src/server/rewards.ts`: thêm helper mở chu kỳ trong transaction duyệt VIP, giữ wrapper nội bộ cũ. Order chờ duyệt không cấp VIP/xu. Admin xác nhận tiền thực nhận mới tạo subscription đã xác minh, mở một chu kỳ thưởng và hoàn tất order/audit nguyên tử. Gia hạn giữ thời gian còn lại; hủy chu kỳ cũ, không tự cộng xu. Giá/tier/lịch thưởng chốt trên order.
- `src/features/admin/money-review.tsx`, `src/features/admin/dashboard-screen.tsx`, `src/server/dashboard.ts`, `src/app/api/admin/money/[kind]/[id]/route.ts`, `src/app/admin/finance/page.tsx`: Admin duyệt VIP và xử lý đổi thưởng, xem bill/ngân hàng/xu/tỷ lệ/phí/thực nhận, phân biệt rút VND và đổi xu. Tổng thu chỉ thêm mua VIP đã xác nhận; tổng chi chỉ tính khoản thực chuyển hoàn tất. Ghi chú nội bộ không gửi cho người dùng.
- `src/features/wallet/request-history.tsx`, `src/features/wallet/payment-screen.tsx`, `src/app/api/money/requests/route.ts`, hai trang nạp/rút VND, `src/features/admin/presentation-data.ts`, `src/features/admin/management-screen.tsx`: lịch sử và tổng tiền tách tài sản; lọc từng tài sản trước LIMIT để giao dịch VND không che lịch sử đổi xu. CSS tái sử dụng `src/features/wallet/manual-money.css`.
- `database/migrations/0006_reward_redemption_vip.sql`: migration bổ sung reserved coin, hợp đồng tài sản của withdrawals, trạng thái FAILED, bảng order mua VIP và loại audit mới. Không xóa hàng dữ liệu. Chỉ đã áp dụng trên QA.

Mọi API yêu cầu session, POST kiểm tra Origin và input strict; thao tác duyệt yêu cầu Admin. Số tiền/tỷ lệ/phí/giá gói lấy ở server. Bank details chỉ trả cho chủ yêu cầu và Admin qua phản hồi private/no-store. Thanh toán/chuyển khoản là thủ công; hệ thống không tự gọi chi hộ. VIP bị từ chối sau khi đã nhận tiền cần hoàn tiền ngân hàng thủ công.

## Kiểm chứng

**55 ca hành vi PASS** (không tính container/suite):

| Kiểm tra                                                  | Kết quả                                                | Bằng chứng                                                                             |
| --------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Giao dịch/đồng thời/quyền sở hữu/giữ-trả xu/VIP/điểm danh | 25 PASS, Postgres Neon thật                            | `tests/rewards-redemption-vip.test.mts`, `test-results/rewards-redemption-server.json` |
| Hồi quy dashboard/library/rewards                         | 11 PASS, Postgres PGlite                               | `tests/dashboard-library.test.mts`                                                     |
| UI/API/Admin và mobile 360/390/430 px                     | 17 PASS, Chromium + localhost + Neon QA                | `scripts/verify-rewards-redemption.mjs`, `test-results/rewards-redemption-ui.json`     |
| Lọc lịch sử trước LIMIT sau hơn 50 giao dịch tài sản khác | 1 PASS, Neon QA                                        | `tests/reward-history.test.mts`                                                        |
| Mất phản hồi sau commit, retry sau Admin hoàn tất         | 1 PASS, request/DB thật, chỉ chủ động làm mất phản hồi | `scripts/verify-reward-retry.mjs`, `test-results/reward-retry-ui.json`                 |
| Typecheck                                                 | PASS                                                   | `npm run typecheck`                                                                    |
| Build Next.js 16.4.0                                      | PASS                                                   | `npm run build`                                                                        |
| Lint                                                      | SKIPPED                                                | Project không có script lint                                                           |

Migration đã giữ nguyên các cột/dữ liệu cũ của 19 bảng trên branch QA `br-quiet-silence-b30z8m9u` (`test-results/rewards-redemption-migration.json`). Tất cả tài khoản/giao dịch tài chính thử nghiệm đều do QA tạo; không dùng tài khoản người dùng thật. Không ghi database production và không tạo Blob mới. Checkout mới đã kiểm tra chọn gói, thiếu/sai bill và preview; upload thành công không chạy lại lên Blob production vì dịch vụ upload cũ không đổi. Luồng VIP API → order → Admin → membership/chu kỳ đã chạy thực tế trên QA, dùng ảnh QA có sẵn.

## Trạng thái phát hành

Production hiện tại không thay đổi. Không commit, push hay deploy. Trước một lần phát hành được cho phép, cần áp dụng migration 0006 bằng migration runner hiện có rồi triển khai code cùng phiên bản; code mới yêu cầu schema mới. Không có vấn đề triển khai còn thiếu trong phạm vi workspace; việc phát hành production chưa được yêu cầu.

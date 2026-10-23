import Link from "next/link";
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-bold">ไม่พบหน้าที่ต้องการ</h1>
      <Link href="/" className="text-brand underline">กลับหน้าแรก</Link>
    </main>
  );
}

import { NextResponse } from "next/server";

// Thunder Solution slip verification (https://document.thunder.in.th) —
// synchronous, no webhook needed. The API key stays server-side only.
export async function POST(req: Request) {
  try {
    const { url, matchAmount } = await req.json();

    if (!url) {
      return NextResponse.json({ error: "ไม่มี URL ของสลิปให้ตรวจสอบ" }, { status: 400 });
    }

    const apiKey = process.env.THUNDER_API_KEY;
    if (!apiKey) {
      console.error("THUNDER_API_KEY is not set");
      return NextResponse.json({ error: "ระบบเช็คสลิปยังไม่ได้ตั้งค่า" }, { status: 500 });
    }

    const expectedAmount = matchAmount !== undefined && matchAmount !== null && !isNaN(Number(matchAmount)) && Number(matchAmount) > 0
      ? Number(matchAmount)
      : null;

    // NOTE: this requires `url` to be a publicly reachable address — Thunder's
    // servers fetch it themselves. On localhost this will fail with
    // IMAGE_URL_UNREACHABLE; it needs either a public deployment or a tunnel
    // (e.g. ngrok) pointed at this app to test locally.
    const thunderRes = await fetch("https://api.thunder.in.th/v2/verify/bank", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        checkDuplicate: true,
        ...(expectedAmount !== null ? { matchAmount: expectedAmount } : {}),
      }),
    });

    const thunderData = await thunderRes.json();

    if (!thunderRes.ok || !thunderData.success) {
      return NextResponse.json({
        success: false,
        errorCode: thunderData?.error?.code || null,
        message: thunderData?.error?.message || "ตรวจสอบสลิปไม่สำเร็จ",
      });
    }

    const rawSlip = thunderData.data?.rawSlip;
    const slipAmount = rawSlip?.amount?.amount ?? null;
    // Compute our own match verdict independent of whatever Thunder's own
    // matchAmount flag returns, so this stays reliable across their API versions.
    const amountMatched = expectedAmount !== null && slipAmount !== null
      ? Math.abs(Number(slipAmount) - expectedAmount) < 0.5
      : null;

    return NextResponse.json({
      success: true,
      isDuplicate: thunderData.data?.isDuplicate ?? false,
      slipAmount,
      expectedAmount,
      amountMatched,
      senderName: rawSlip?.sender?.account?.name?.th || null,
      senderBank: rawSlip?.sender?.bank?.short || rawSlip?.sender?.bank?.name || null,
      receiverName: rawSlip?.receiver?.account?.name?.th || null,
      receiverBank: rawSlip?.receiver?.bank?.short || rawSlip?.receiver?.bank?.name || null,
      transRef: rawSlip?.transRef || null,
      date: rawSlip?.date || null,
    });
  } catch (error) {
    console.error("Error verifying slip:", error);
    return NextResponse.json(
      { success: false, message: "เกิดข้อผิดพลาดขณะเช็คสลิป กรุณาลองใหม่อีกครั้ง" },
      { status: 200 }
    );
  }
}

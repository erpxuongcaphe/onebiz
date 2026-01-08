"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, XCircle, LogIn, LogOut, Loader2, ArrowLeft, Clock } from "lucide-react";
import { Html5Qrcode } from "html5-qrcode";
import { useAuth } from "@/contexts/AuthContext";
import { checkInByQR, getAttendanceRecords, AttendanceRecord } from "@/lib/api/timekeeping";
import { cn } from "@/lib/utils";
import Link from "next/link";

// Random motivational messages
const checkinMessages = [
    "Chúc bạn một ngày tràn đầy năng lượng! 💪",
    "Cùng bùng nổ doanh số nhé! 🚀",
    "Khởi đầu ngày mới thật tuyệt vời! ☀️",
    "Cố lên, hôm nay sẽ là một ngày tốt lành! 🍀",
    "Chào buổi sáng, chiến thôi nào! 🔥",
    "Ngày mới, cơ hội mới! ✨"
];

const checkoutMessages = [
    "Cảm ơn bạn đã vất vả hôm nay! ❤️",
    "Về nghỉ ngơi nạp năng lượng nhé! 🌙",
    "Hẹn gặp lại bạn vào ngày mai! 👋",
    "Bạn đã làm rất tốt, chúc ngủ ngon! ⭐️",
    "Nghỉ ngơi xứng đáng sau một ngày dài! 🏠",
    "Tạm biệt, mai gặp lại nhé! 🌟"
];

// Success sound as base64 (short ding/chime sound)
const successSoundBase64 = "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7v////////////////////////////////AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/7UMQAAAAAANIAAAAAExBLEp5gAADCAAHCAYPjgI49IQRFQH8EAi6YEDB8EOHBCIi/CEIQhCEId/5L/lCEIQhCHf////////////8QQAAAAAgAAAABi3IhNFkGLciE0WQYtyITRZBi3IhNFkGLciE0WQYtyITRZAAADAAABhCEIQhCEIQhCEIQhCEIQhCEIQhCEIQhCEBhCEIQhCEIQhCEIQhCEL/+1LEBAAEN1DaZYxAIIbqG0yxiAQ+jCEIQhCEIQhCEIQhAAAKD4H4AABQfBQfA/8CAOAB//AgDAwcH/h3/h/4d/4h//h8P/D+AgDg/AAYAAB/gfEEAYDBA+CQB+YBAGBg/w8EAwcEQBgYOD/D4f+H/h/4OB/8O/4EAZg//tQxBGAAADSAAAAAAAAANIAAAAASAA4EAgGDA4IMECAMDBwf4cA4OH/h/4IBg4P8O/8CA//DwIAAIAAD/A/w4EOBgIOCAYMDBw7/+BxAKBhQlEP/4QDChKIf/wgGFCUQ//sAYMJRD/+wABAgAf/7UMQSAAAA0gAAAAAA0gAAAABJhIAAAAAOBAAB+f/8VQAAAABxBAEAQBEEQBEMYIb/EEQRBEERBEAR/BBBBBEQRBEERAIIEEf/BAH4gg/EIf+IQh+IQ/EEIIJ/BH///+IP//xD/xD8Q/0IQ8";

// Success Popup Component
function SuccessPopup({
    isVisible,
    action,
    message,
    onClose
}: {
    isVisible: boolean;
    action: 'check_in' | 'check_out';
    message: string;
    onClose: () => void;
}) {
    useEffect(() => {
        if (isVisible) {
            // Play success sound
            const audio = new Audio(successSoundBase64);
            audio.volume = 0.5;
            audio.play().catch(console.error);

            // Auto close after 3 seconds
            const timer = setTimeout(() => {
                onClose();
            }, 3000);

            return () => clearTimeout(timer);
        }
    }, [isVisible, onClose]);

    if (!isVisible) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative bg-white rounded-3xl shadow-2xl p-8 max-w-sm w-full animate-bounce-in">
                {/* Animated Success Icon */}
                <div className="flex justify-center mb-6">
                    <div className={cn(
                        "w-24 h-24 rounded-full flex items-center justify-center",
                        action === 'check_in'
                            ? "bg-gradient-to-br from-green-400 to-emerald-500"
                            : "bg-gradient-to-br from-blue-400 to-indigo-500"
                    )}>
                        <div className="animate-success-checkmark">
                            {action === 'check_in' ? (
                                <LogIn className="w-12 h-12 text-white" strokeWidth={2.5} />
                            ) : (
                                <LogOut className="w-12 h-12 text-white" strokeWidth={2.5} />
                            )}
                        </div>
                    </div>
                </div>

                {/* Title */}
                <h2 className={cn(
                    "text-2xl font-bold text-center mb-3",
                    action === 'check_in' ? "text-green-600" : "text-blue-600"
                )}>
                    {action === 'check_in' ? 'Check-in thành công!' : 'Check-out thành công!'}
                </h2>

                {/* Motivational Message */}
                <p className="text-center text-lg text-slate-700 mb-2">
                    {message}
                </p>

                {/* Progress bar for auto-close */}
                <div className="mt-6 h-1 bg-slate-100 rounded-full overflow-hidden">
                    <div
                        className={cn(
                            "h-full animate-shrink-width",
                            action === 'check_in' ? "bg-green-500" : "bg-blue-500"
                        )}
                    />
                </div>
            </div>
        </div>
    );
}

export default function AttendancePage() {
    const router = useRouter();
    const { user, isLoading, isAuthenticated } = useAuth();
    const [isScanning, setIsScanning] = useState(false);
    const [isCameraStarting, setIsCameraStarting] = useState(false);
    const [cameraError, setCameraError] = useState<string | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [result, setResult] = useState<{
        success: boolean;
        message: string;
        action?: 'check_in' | 'check_out';
    } | null>(null);
    const [recentRecords, setRecentRecords] = useState<AttendanceRecord[]>([]);
    const scannerRef = useRef<Html5Qrcode | null>(null);
    const hasStartedRef = useRef(false);

    // Popup state
    const [showSuccessPopup, setShowSuccessPopup] = useState(false);
    const [popupMessage, setPopupMessage] = useState("");
    const [popupAction, setPopupAction] = useState<'check_in' | 'check_out'>('check_in');

    // Fetch recent attendance records
    useEffect(() => {
        if (user) {
            fetchRecentRecords();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user]);

    const fetchRecentRecords = async () => {
        if (!user) return;
        try {
            const records = await getAttendanceRecords({ employeeId: user.id });
            setRecentRecords(records.slice(0, 5)); // Last 5 records
        } catch (err) {
            console.error('Failed to fetch records:', err);
        }
    };

    // Get random motivational message
    const getRandomMessage = (action: 'check_in' | 'check_out') => {
        const messages = action === 'check_in' ? checkinMessages : checkoutMessages;
        return messages[Math.floor(Math.random() * messages.length)];
    };

    // Handle popup close
    const handlePopupClose = useCallback(() => {
        setShowSuccessPopup(false);
    }, []);

    // Handle QR scan result - with GPS validation
    const handleScanSuccess = useCallback(async (qrToken: string) => {
        if (isProcessing || !user) return;

        // Stop scanner first
        stopScanner();
        setIsProcessing(true);
        setResult(null);

        try {
            // Get user's current GPS location - REQUIRED for check-in
            let userLocation: { lat: number; lng: number } | undefined;

            if (!navigator.geolocation) {
                setResult({
                    success: false,
                    message: 'Thiết bị của bạn không hỗ trợ GPS. Vui lòng sử dụng thiết bị khác để chấm công.'
                });
                setIsProcessing(false);
                return;
            }

            try {
                const position = await new Promise<GeolocationPosition>((resolve, reject) => {
                    navigator.geolocation.getCurrentPosition(resolve, reject, {
                        enableHighAccuracy: true,
                        timeout: 15000,
                        maximumAge: 0
                    });
                });
                userLocation = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude
                };
            } catch (geoError) {
                console.warn('GPS error:', geoError);
                const errorMessage = geoError instanceof GeolocationPositionError
                    ? geoError.code === 1
                        ? 'Bạn đã từ chối quyền truy cập vị trí. Vui lòng cấp quyền GPS trong cài đặt trình duyệt để chấm công.'
                        : geoError.code === 2
                            ? 'Không thể xác định vị trí. Vui lòng kiểm tra GPS và thử lại.'
                            : 'Quá thời gian lấy vị trí. Vui lòng thử lại.'
                    : 'Không thể lấy vị trí GPS. Vui lòng cấp quyền và thử lại.';

                setResult({
                    success: false,
                    message: errorMessage
                });
                setIsProcessing(false);
                return;
            }

            const response = await checkInByQR(user.id, qrToken, userLocation);

            if (response.success && response.action) {
                // Show success popup with random message
                const randomMessage = getRandomMessage(response.action);
                setPopupMessage(randomMessage);
                setPopupAction(response.action);
                setShowSuccessPopup(true);

                // Also set result for the page display
                setResult({
                    success: response.success,
                    message: response.message,
                    action: response.action
                });

                // Refresh records after successful check-in/out
                await fetchRecentRecords();
            } else {
                setResult({
                    success: response.success,
                    message: response.message,
                    action: response.action
                });
            }
        } catch (err) {
            console.error('Check-in error:', err);
            setResult({
                success: false,
                message: 'Đã xảy ra lỗi. Vui lòng thử lại.'
            });
        } finally {
            setIsProcessing(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isProcessing, user]);

    // Start camera immediately
    const startScanner = useCallback(async () => {
        if (scannerRef.current || hasStartedRef.current) return;

        hasStartedRef.current = true;
        setResult(null);
        setCameraError(null);
        setIsCameraStarting(true);
        setIsScanning(true); // Set this FIRST so DOM element renders

        // Wait for DOM to update
        await new Promise(resolve => setTimeout(resolve, 100));

        try {
            const html5Qrcode = new Html5Qrcode("qr-reader");
            scannerRef.current = html5Qrcode;

            await html5Qrcode.start(
                { facingMode: "environment" }, // Back camera preferred
                {
                    fps: 10,
                    qrbox: { width: 250, height: 250 }
                },
                (decodedText) => {
                    handleScanSuccess(decodedText);
                },
                () => {
                    // Ignore scan errors during scanning
                }
            );

            setIsCameraStarting(false);
        } catch (err) {
            console.error('Camera error:', err);
            hasStartedRef.current = false;
            setIsCameraStarting(false);
            setIsScanning(false);
            setCameraError(
                err instanceof Error && err.message.includes('Permission')
                    ? 'Vui lòng cấp quyền camera để chấm công'
                    : 'Không thể mở camera. Vui lòng thử lại.'
            );
        }
    }, [handleScanSuccess]);

    const stopScanner = useCallback(() => {
        if (scannerRef.current) {
            scannerRef.current.stop().catch(console.error);
            scannerRef.current = null;
        }
        hasStartedRef.current = false;
        setIsScanning(false);
    }, []);

    // Auto-start scanner when page loads and user is authenticated
    useEffect(() => {
        if (user && !hasStartedRef.current && !result && !isProcessing) {
            // Small delay to ensure DOM is ready
            const timer = setTimeout(() => {
                startScanner();
            }, 300);
            return () => clearTimeout(timer);
        }
    }, [user, result, isProcessing, startScanner]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (scannerRef.current) {
                scannerRef.current.stop().catch(console.error);
            }
        };
    }, []);

    const formatTime = (dateString?: string) => {
        if (!dateString) return '--:--';
        return new Date(dateString).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('vi-VN', {
            weekday: 'short',
            day: '2-digit',
            month: '2-digit'
        });
    };

    // Redirect to login if not authenticated
    useEffect(() => {
        if (!isLoading && !isAuthenticated) {
            router.push('/login');
        }
    }, [isLoading, isAuthenticated, router]);

    // Show loading while checking auth
    if (isLoading || !user) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
                <div className="text-center">
                    <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-4" />
                    <p className="text-slate-600">{isLoading ? 'Đang kiểm tra đăng nhập...' : 'Đang chuyển hướng...'}</p>
                </div>
            </div>
        );
    }

    return (
        <>
            {/* Success Popup */}
            <SuccessPopup
                isVisible={showSuccessPopup}
                action={popupAction}
                message={popupMessage}
                onClose={handlePopupClose}
            />

            <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
                {/* Header */}
                <div className="bg-white border-b border-slate-200 px-4 py-4 sticky top-0 z-10">
                    <div className="max-w-lg mx-auto flex items-center gap-3">
                        <Link
                            href="/dashboard"
                            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div>
                            <h1 className="text-lg font-bold text-slate-900">Chấm công</h1>
                            <p className="text-xs text-slate-500">Quét mã QR để check-in/out</p>
                        </div>
                    </div>
                </div>

                <div className="max-w-lg mx-auto p-4 space-y-6">
                    {/* User Info Card */}
                    <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-xl gradient-primary flex items-center justify-center text-white font-bold">
                                {user.fullName?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || 'U'}
                            </div>
                            <div>
                                <p className="font-semibold text-slate-900">{user.fullName || 'Nhân viên'}</p>
                                <p className="text-sm text-slate-500">{user.email}</p>
                            </div>
                        </div>
                    </div>

                    {/* Scanner Section */}
                    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                        {/* QR Reader - ALWAYS in DOM, visibility controlled by state */}
                        <div
                            id="qr-reader"
                            className="rounded-xl overflow-hidden mb-4"
                            style={{
                                minHeight: isScanning && !isCameraStarting ? '300px' : '0px',
                                display: isScanning ? 'block' : 'none'
                            }}
                        />

                        {/* Camera starting state */}
                        {isCameraStarting && (
                            <div className="text-center py-8">
                                <Loader2 className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
                                <p className="text-slate-600">Đang mở camera...</p>
                            </div>
                        )}

                        {/* Cancel button when scanning */}
                        {isScanning && !isCameraStarting && !cameraError && (
                            <button
                                onClick={stopScanner}
                                className="w-full py-3 bg-slate-100 text-slate-700 font-medium rounded-xl hover:bg-slate-200 transition-colors"
                            >
                                Hủy quét
                            </button>
                        )}

                        {/* Camera error state */}
                        {cameraError && !isCameraStarting && (
                            <div className="text-center">
                                <div className="w-20 h-20 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                                    <XCircle className="w-10 h-10 text-red-500" />
                                </div>
                                <h2 className="text-lg font-semibold text-slate-900 mb-2">Lỗi Camera</h2>
                                <p className="text-sm text-slate-500 mb-6">{cameraError}</p>
                                <button
                                    onClick={() => {
                                        setCameraError(null);
                                        hasStartedRef.current = false;
                                        startScanner();
                                    }}
                                    className="w-full py-3 gradient-primary text-white font-medium rounded-xl shadow-lg shadow-blue-500/20 hover:shadow-xl transition-all"
                                >
                                    Thử lại
                                </button>
                            </div>
                        )}

                        {isProcessing && (
                            <div className="text-center py-8">
                                <Loader2 className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
                                <p className="text-slate-600">Đang xử lý...</p>
                            </div>
                        )}

                        {result && (
                            <div className="text-center">
                                <div className={cn(
                                    "w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4",
                                    result.success ? "bg-green-100" : "bg-red-100"
                                )}>
                                    {result.success ? (
                                        result.action === 'check_in' ? (
                                            <LogIn className="w-10 h-10 text-green-600" />
                                        ) : (
                                            <LogOut className="w-10 h-10 text-green-600" />
                                        )
                                    ) : (
                                        <XCircle className="w-10 h-10 text-red-600" />
                                    )}
                                </div>
                                <h3 className={cn(
                                    "text-lg font-semibold mb-2",
                                    result.success ? "text-green-700" : "text-red-700"
                                )}>
                                    {result.success
                                        ? (result.action === 'check_in' ? 'Check-in thành công!' : 'Check-out thành công!')
                                        : 'Thất bại!'
                                    }
                                </h3>
                                <p className="text-sm text-slate-600 mb-6">{result.message}</p>
                                <button
                                    onClick={() => setResult(null)}
                                    className="w-full py-3 gradient-primary text-white font-medium rounded-xl shadow-lg shadow-blue-500/20 hover:shadow-xl transition-all"
                                >
                                    Quét lại
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Recent Records */}
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                        <div className="p-4 border-b border-slate-100 flex items-center gap-2">
                            <Clock className="w-5 h-5 text-slate-400" />
                            <h3 className="font-semibold text-slate-900">Lịch sử gần đây</h3>
                        </div>
                        <div className="divide-y divide-slate-50">
                            {recentRecords.length > 0 ? (
                                recentRecords.map((record) => (
                                    <div key={record.id} className="p-4 flex items-center justify-between">
                                        <div>
                                            <p className="text-sm font-medium text-slate-900">
                                                {formatDate(record.date)}
                                            </p>
                                            <p className="text-xs text-slate-500">
                                                {formatTime(record.check_in)} - {formatTime(record.check_out)}
                                            </p>
                                        </div>
                                        <div className="text-right">
                                            <span className={cn(
                                                "inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full",
                                                record.check_out && "bg-green-50 text-green-700",
                                                !record.check_out && record.status === 'pending' && "bg-amber-50 text-amber-700",
                                                record.status === 'ontime' && "bg-blue-50 text-blue-700"
                                            )}>
                                                {record.check_out && <CheckCircle className="w-3 h-3" />}
                                                {record.hours_worked ? `${record.hours_worked}h` : 'Đang làm'}
                                            </span>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="p-8 text-center text-sm text-slate-400">
                                    Chưa có lịch sử chấm công
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}

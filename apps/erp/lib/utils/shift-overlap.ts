/**
 * Utility functions for detecting overlapping shifts
 * Used across shift registration, approval, and schedule pages
 */

export interface ShiftTime {
    id?: string;
    start_time: string; // Format: "HH:MM" or "HH:MM:SS"
    end_time: string;
    name?: string;
}

/**
 * Parse time string to minutes from midnight
 * Handles both "HH:MM" and "HH:MM:SS" formats
 */
function parseTimeToMinutes(time: string): number {
    const parts = time.split(':');
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    return hours * 60 + minutes;
}

/**
 * Check if two shifts overlap
 * Returns true if there's any overlap in time
 * 
 * Note: Handles edge case where end_time === start_time (adjacent shifts are NOT overlapping)
 * 
 * @example
 * doShiftsOverlap({start: "08:00", end: "12:00"}, {start: "11:00", end: "15:00"}) // true (overlap 11:00-12:00)
 * doShiftsOverlap({start: "08:00", end: "12:00"}, {start: "12:00", end: "16:00"}) // false (adjacent)
 * doShiftsOverlap({start: "08:00", end: "12:00"}, {start: "13:00", end: "17:00"}) // false (no overlap)
 */
export function doShiftsOverlap(shift1: ShiftTime, shift2: ShiftTime): boolean {
    const start1 = parseTimeToMinutes(shift1.start_time);
    const end1 = parseTimeToMinutes(shift1.end_time);
    const start2 = parseTimeToMinutes(shift2.start_time);
    const end2 = parseTimeToMinutes(shift2.end_time);

    // Handle overnight shifts (e.g., 22:00-06:00)
    const isShift1Overnight = end1 < start1;
    const isShift2Overnight = end2 < start2;

    if (isShift1Overnight || isShift2Overnight) {
        // For overnight shifts, we need special handling
        // Convert to a 24+ hour scale for comparison
        const adjustedEnd1 = isShift1Overnight ? end1 + 24 * 60 : end1;
        const adjustedEnd2 = isShift2Overnight ? end2 + 24 * 60 : end2;

        // Also need to consider the shifted version
        const shift1Ranges = isShift1Overnight
            ? [[start1, 24 * 60], [0, end1]]
            : [[start1, adjustedEnd1]];
        const shift2Ranges = isShift2Overnight
            ? [[start2, 24 * 60], [0, end2]]
            : [[start2, adjustedEnd2]];

        // Check all combinations
        for (const [s1, e1] of shift1Ranges) {
            for (const [s2, e2] of shift2Ranges) {
                if (s1 < e2 && e1 > s2) {
                    return true;
                }
            }
        }
        return false;
    }

    // Standard overlap check for non-overnight shifts
    // Two ranges [start1, end1] and [start2, end2] overlap if:
    // start1 < end2 AND end1 > start2
    return start1 < end2 && end1 > start2;
}

/**
 * Get the overlapping time range between two shifts
 * Returns null if no overlap
 */
export function getOverlapRange(shift1: ShiftTime, shift2: ShiftTime): { start: string; end: string } | null {
    if (!doShiftsOverlap(shift1, shift2)) {
        return null;
    }

    const start1 = parseTimeToMinutes(shift1.start_time);
    const end1 = parseTimeToMinutes(shift1.end_time);
    const start2 = parseTimeToMinutes(shift2.start_time);
    const end2 = parseTimeToMinutes(shift2.end_time);

    const overlapStart = Math.max(start1, start2);
    const overlapEnd = Math.min(end1, end2);

    const formatTime = (minutes: number): string => {
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    };

    return {
        start: formatTime(overlapStart),
        end: formatTime(overlapEnd)
    };
}

/**
 * Find all shifts that overlap with a target shift
 * Returns array of shift IDs that overlap
 */
export function getOverlappingShiftIds(
    targetShift: ShiftTime,
    otherShifts: ShiftTime[]
): string[] {
    return otherShifts
        .filter(shift => shift.id && doShiftsOverlap(targetShift, shift))
        .map(shift => shift.id!);
}

/**
 * Check if any shifts in a list overlap with each other
 * Returns detailed conflict information
 */
export function findOverlapConflicts(
    shifts: ShiftTime[]
): {
    hasConflicts: boolean;
    conflicts: Array<{
        shift1: ShiftTime;
        shift2: ShiftTime;
        overlapRange: { start: string; end: string };
    }>;
} {
    const conflicts: Array<{
        shift1: ShiftTime;
        shift2: ShiftTime;
        overlapRange: { start: string; end: string };
    }> = [];

    for (let i = 0; i < shifts.length; i++) {
        for (let j = i + 1; j < shifts.length; j++) {
            const overlapRange = getOverlapRange(shifts[i], shifts[j]);
            if (overlapRange) {
                conflicts.push({
                    shift1: shifts[i],
                    shift2: shifts[j],
                    overlapRange
                });
            }
        }
    }

    return {
        hasConflicts: conflicts.length > 0,
        conflicts
    };
}

/**
 * Group shifts by date and check for overlaps within each date
 * Useful for validating bulk registrations/schedules
 */
export function validateShiftsByDate(
    shiftsWithDates: Array<{ date: string; shift: ShiftTime }>
): {
    isValid: boolean;
    errors: Array<{
        date: string;
        shift1Name: string;
        shift2Name: string;
        overlapRange: { start: string; end: string };
    }>;
} {
    // Group by date
    const byDate: Record<string, ShiftTime[]> = {};
    for (const item of shiftsWithDates) {
        if (!byDate[item.date]) {
            byDate[item.date] = [];
        }
        byDate[item.date].push(item.shift);
    }

    const errors: Array<{
        date: string;
        shift1Name: string;
        shift2Name: string;
        overlapRange: { start: string; end: string };
    }> = [];

    // Check each date for conflicts
    for (const [date, shifts] of Object.entries(byDate)) {
        const { conflicts } = findOverlapConflicts(shifts);
        for (const conflict of conflicts) {
            errors.push({
                date,
                shift1Name: conflict.shift1.name || 'Ca 1',
                shift2Name: conflict.shift2.name || 'Ca 2',
                overlapRange: conflict.overlapRange
            });
        }
    }

    return {
        isValid: errors.length === 0,
        errors
    };
}

/**
 * Format overlap error message in Vietnamese
 */
export function formatOverlapError(
    shift1Name: string,
    shift2Name: string,
    overlapRange?: { start: string; end: string }
): string {
    if (overlapRange) {
        return `Ca "${shift1Name}" trùng giờ với "${shift2Name}" (${overlapRange.start} - ${overlapRange.end})`;
    }
    return `Ca "${shift1Name}" trùng giờ với "${shift2Name}"`;
}

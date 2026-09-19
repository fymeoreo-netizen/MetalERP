import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Get the current date in YYYY-MM-DD format without timezone conversion
 * This ensures consistent date handling across the application
 */
export function getTodayDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Format a Date object to YYYY-MM-DD without timezone conversion
 */
export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Format time from Date object as HH:MM:SS without timezone conversion
 */
export function formatLocalTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Calculate hours worked from check-in and check-out times
 * Handles night shifts that cross midnight (e.g., 7 PM to 8 AM)
 * 
 * @param checkInTime - Time string in HH:MM or HH:MM:SS format (e.g., "19:00" or "19:00:00")
 * @param checkOutTime - Time string in HH:MM or HH:MM:SS format (e.g., "08:00" or "08:00:00")
 * @returns Hours worked as a number (e.g., 13.0 for 13 hours)
 * 
 * @example
 * // Day shift: 9 AM to 5 PM = 8 hours
 * calculateHoursWorked("09:00", "17:00") // Returns 8.0
 * 
 * @example
 * // Night shift crossing midnight: 7 PM to 8 AM = 13 hours
 * calculateHoursWorked("19:00", "08:00") // Returns 13.0
 */
export function calculateHoursWorked(checkInTime: string, checkOutTime: string): number {
  if (!checkInTime || !checkOutTime) {
    return 0;
  }

  // Parse time strings (handle both HH:MM and HH:MM:SS formats)
  const parseTime = (timeStr: string): number => {
    const parts = timeStr.split(':');
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1] || '0', 10);
    return hours * 60 + minutes; // Convert to total minutes
  };

  const checkInMinutes = parseTime(checkInTime);
  const checkOutMinutes = parseTime(checkOutTime);

  let totalMinutes: number;

  // If checkout time is earlier than checkin time, it means the shift crossed midnight
  // Example: Check-in at 19:00 (1140 min), Check-out at 08:00 (480 min)
  // Since 480 < 1140, we add 24 hours (1440 minutes) to handle the midnight crossover
  if (checkOutMinutes < checkInMinutes) {
    // Night shift crossing midnight: add 24 hours
    totalMinutes = checkOutMinutes + (24 * 60) - checkInMinutes;
  } else {
    // Regular day shift: simple subtraction
    totalMinutes = checkOutMinutes - checkInMinutes;
  }

  // Convert minutes to hours and round to 2 decimal places
  const hours = totalMinutes / 60;
  return Math.max(0, Number(hours.toFixed(2)));
}
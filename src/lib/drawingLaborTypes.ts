export type DrawingLaborSettings = {
    id: string;
    baseRatePkr: number;
    effectiveFrom: string;
};

export type DrawingPremiumRate = {
    id: string;
    gaugeSwg: number;
    incrementPkr: number;
    ratePkrOverride: number | null;
    effectiveFrom: string;
    effectiveRatePkr: number;
};

export type DrawingWeekWeights = {
    receivedKg: number;
    scrapKg: number;
    /** Display-only: wire issued to drawing production in the week */
    issuedKg?: number;
};

export type DrawingPremiumLine = {
    id?: string;
    lineNo: number;
    gaugeSwg: number;
    weightKg: number;
    ratePkrPerKg: number;
    amountPkr: number;
};

export type DrawingWeeklyWageSheet = {
    id: string;
    sheetNo: string;
    weekStart: string;
    weekEnd: string;
    status: "draft" | "posted";
    wire8ReceivedKg: number;
    wire8ScrapKg: number;
    wire8ReceivedOverride: number | null;
    wire8ScrapOverride: number | null;
    netWire8Kg: number;
    baseRatePkr: number;
    baseWagePkr: number;
    premiumWagePkr: number;
    totalWagePkr: number;
    notes: string | null;
    premiumLines: DrawingPremiumLine[];
    postedAt: string | null;
};

export type DrawingPremiumLineInput = {
    gaugeSwg: number;
    weightKg: number;
};

export type SaveDrawingWageSheetInput = {
    sheetId: string;
    wire8ReceivedOverride?: number | null;
    wire8ScrapOverride?: number | null;
    notes?: string;
    premiumLines: DrawingPremiumLineInput[];
};

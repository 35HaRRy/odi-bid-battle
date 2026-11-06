export interface StatisticsOverview {
  candidates: number;
  lists: number;
  battlefields: number;
  auctions: {
    id: string;
    name: string;
    status: string;
    soldCount: number;
    spentGold: number;
  }[];
}

export interface AuctionStatistics {
  id: string;
  name: string;
  status: string;
  teams: {
    position: 0 | 1;
    name: string;
    spentGold: number;
    remainingGold: number;
    acquiredCount: number;
    members: { id: string; name: string; spentGold: number; remainingGold: number }[];
  }[];
  sales: {
    candidateId: string;
    name: string;
    price: number;
    winner: 0 | 1;
    winningContributions: { name: string; amount: number }[] | null;
    losingContributions: { name: string; amount: number }[] | null;
  }[];
}

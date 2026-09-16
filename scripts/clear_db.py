#!/usr/bin/env python3
"""Veritabandaki tum kayitlari siler (TRUNCATE CASCADE).

Kullanim:
    pip install psycopg2-binary
    python scripts/clear_db.py --yes
    python scripts/clear_db.py --dry-run
    DATABASE_URL=postgres://bidbattle:bidbattle@localhost:5433/bidbattle python scripts/clear_db.py

Guvenlik:
    - Varsayilan olarak onay ister, --yes verilmeden silmez.
    - Hedef baglantiyi silmeden once ekrana yazar.
    - TRUNCATE ... CASCADE kullanir, FK sirasina takilmaz.
"""
from __future__ import annotations

import argparse
import os
import sys

DEFAULT_DATABASE_URL = "postgres://bidbattle:bidbattle@localhost:5433/bidbattle"

# FK bagimli tablolar once gelse de TRUNCATE CASCADE ile sira onemsiz.
TABLES = [
    "auction_team_members",
    "auction_teams",
    "auction_entries",
    "auction_live_state",
    "auction_live_balances",
    "auction_live_contributions",
    "auction_live_latest",
    "auction_live_skipped",
    "auction_live_acquired",
    "auction_live_history",
    "list_entries",
    "auctions",
    "candidate_lists",
    "candidates",
    "battlefields",
]


def get_conn(database_url: str):
    try:
        import psycopg2  # type: ignore
    except ImportError:
        try:
            import psycopg as psycopg2  # type: ignore  # psycopg v3 uyumu
        except ImportError:
            print(
                "HATA: psycopg2 veya psycopg kurulu degil. "
                "Kurulum: pip install psycopg2-binary",
                file=sys.stderr,
            )
            sys.exit(2)
    return psycopg2.connect(database_url)


def table_counts(cur) -> dict[str, int]:
    out: dict[str, int] = {}
    for t in TABLES:
        cur.execute(f'SELECT COUNT(*) FROM "{t}"')  # type: ignore[arg-type]
        row = cur.fetchone()
        out[t] = int(row[0] if row else 0)
    return out


def print_counts(counts: dict[str, int], title: str) -> None:
    print(f"\n{title}")
    for t in TABLES:
        print(f"  {t}: {counts.get(t, 0)}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Tum tablolari bosalt (TRUNCATE CASCADE).")
    ap.add_argument(
        "--database-url",
        default=os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL),
        help="Postgres baglanti adresi (varsayilan: env DATABASE_URL veya local docker).",
    )
    ap.add_argument(
        "-y", "--yes", action="store_true",
        help="Onay sorusunu atla. Verilmezse interaktif onay istenir.",
    )
    ap.add_argument(
        "--dry-run", action="store_true",
        help="Silme yapmadan sadece satir sayilarini goster.",
    )
    args = ap.parse_args()

    print(f"Hedef veritabani: {args.database_url}")

    conn = get_conn(args.database_url)
    try:
        with conn:
            with conn.cursor() as cur:
                before = table_counts(cur)
        print_counts(before, "Silme oncesi satir sayilari:")
        total = sum(before.values())
        print(f"Toplam: {total} satir silinecek.")

        if args.dry_run:
            print("\n--dry-run: hicbir sey silinmedi.")
            return 0

        if total == 0:
            print("Veritabani zaten bos, yapilacak islem yok.")
            return 0

        if not args.yes:
            answer = input(
                "\nDIKKAT: Tum kayitlar kalici olarak silinecek! Devam edilsin mi? [y/N]: "
            ).strip().lower()
            if answer not in ("y", "yes", "e", "evet"):
                print("Iptal edildi, hicbir sey silinmedi.")
                return 1

        with conn:
            with conn.cursor() as cur:
                tables_sql = ", ".join(f'"{t}"' for t in TABLES)
                cur.execute(f"TRUNCATE TABLE {tables_sql} RESTART IDENTITY CASCADE")  # type: ignore[arg-type]
                after = table_counts(cur)
        print_counts(after, "Silme sonrasi satir sayilari:")
        print("\nTamamlandi: tum kayitlar silindi.")
        return 0
    except Exception as exc:  # baglanti / SQL hatasi
        print(f"HATA: {exc}", file=sys.stderr)
        return 1
    finally:
        try:
            conn.close()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())

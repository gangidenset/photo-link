#!/usr/bin/env bash
# マイグレーションと RLS テストを素の PostgreSQL で実行する
#   使い方: PGHOST=... PGPORT=... PGUSER=postgres ./supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=photolink_test
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
psql -q -v ON_ERROR_STOP=1 -d $DB -f tests/stubs.sql
psql -q -v ON_ERROR_STOP=1 -d $DB -c "create extension pgcrypto with schema extensions"
for f in migrations/*.sql; do
  echo "== $f"
  psql -q -v ON_ERROR_STOP=1 -d $DB -f "$f"
done
echo "== tests/rls_test.sql"
psql -q -v ON_ERROR_STOP=1 -d $DB -f tests/rls_test.sql
echo "ALL TESTS PASSED"

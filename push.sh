#!/bin/bash
# ═══════════════════════════════════════════════════════
#  DiaDem — Auto Git Push
#  Автоматичний коміт та пуш в репозиторій
# ═══════════════════════════════════════════════════════

set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_DIR"

# Кольори
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${CYAN}${BOLD}"
echo "  ╔═══════════════════════════════════╗"
echo "  ║     🔷 DiaDem — Auto Push 🔷     ║"
echo "  ╚═══════════════════════════════════╝"
echo -e "${NC}"

# 1. Ініціалізація git, якщо ще не було
if [ ! -d ".git" ]; then
    echo -e "${YELLOW}⚡ Ініціалізація git репозиторію...${NC}"
    git init
    echo -e "${GREEN}✔ Git ініціалізовано${NC}"
fi

# 2. Перевірка чи є remote
if ! git remote get-url origin &>/dev/null; then
    echo ""
    echo -e "${YELLOW}⚠  Remote 'origin' не налаштовано!${NC}"
    echo -e "${BOLD}Введи URL репозиторію (GitHub/GitLab):${NC}"
    echo -e "${CYAN}  Приклад: https://github.com/username/DiaDem.git${NC}"
    echo -e "${CYAN}  Приклад: git@github.com:username/DiaDem.git${NC}"
    echo ""
    read -p "  URL: " REMOTE_URL

    if [ -z "$REMOTE_URL" ]; then
        echo -e "${RED}✘ URL не вказано. Вихід.${NC}"
        exit 1
    fi

    git remote add origin "$REMOTE_URL"
    echo -e "${GREEN}✔ Remote додано: ${REMOTE_URL}${NC}"
fi

# 3. Визначити поточну гілку
BRANCH=$(git branch --show-current 2>/dev/null || echo "main")
if [ -z "$BRANCH" ]; then
    BRANCH="main"
    git checkout -b "$BRANCH" 2>/dev/null || true
fi

# 4. Перевірити зміни
CHANGES=$(git status --porcelain 2>/dev/null)
if [ -z "$CHANGES" ]; then
    echo -e "${GREEN}✔ Нічого комітити — все чисто!${NC}"
    exit 0
fi

# 5. Показати що змінилося
echo -e "${BOLD}📋 Зміни:${NC}"
echo "$CHANGES" | while read -r line; do
    STATUS="${line:0:2}"
    FILE="${line:3}"
    case "$STATUS" in
        "??") echo -e "  ${GREEN}+ новий:${NC}     $FILE" ;;
        " M"|"M "|"MM") echo -e "  ${YELLOW}~ змінено:${NC}   $FILE" ;;
        " D"|"D ") echo -e "  ${RED}- видалено:${NC}  $FILE" ;;
        *) echo -e "  ${CYAN}  інше:${NC}     $FILE" ;;
    esac
done
echo ""

# 6. Автоматичне повідомлення коміту
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
ADDED=$(echo "$CHANGES" | grep -c "^??" || true)
MODIFIED=$(echo "$CHANGES" | grep -c "^ M\|^M \|^MM" || true)
DELETED=$(echo "$CHANGES" | grep -c "^ D\|^D " || true)

PARTS=()
[ "$ADDED" -gt 0 ] && PARTS+=("додано: $ADDED")
[ "$MODIFIED" -gt 0 ] && PARTS+=("змінено: $MODIFIED")
[ "$DELETED" -gt 0 ] && PARTS+=("видалено: $DELETED")

SUMMARY=$(IFS=", "; echo "${PARTS[*]}")
COMMIT_MSG="update: ${SUMMARY} [${TIMESTAMP}]"

echo -e "${BOLD}💬 Коміт:${NC} $COMMIT_MSG"
echo ""

# 7. Додати, закомітити, запушити
git add -A
git commit -m "$COMMIT_MSG"

echo ""
echo -e "${CYAN}🚀 Пушу в ${BOLD}origin/${BRANCH}${NC}${CYAN}...${NC}"

if git push -u origin "$BRANCH" 2>&1; then
    echo ""
    echo -e "${GREEN}${BOLD}"
    echo "  ╔═══════════════════════════════════╗"
    echo "  ║        ✔ Пуш успішний! ✔         ║"
    echo "  ╚═══════════════════════════════════╝"
    echo -e "${NC}"
else
    echo ""
    echo -e "${YELLOW}⚠  Перша спроба не вдалась, пробую з --set-upstream...${NC}"
    git push --set-upstream origin "$BRANCH" 2>&1 || {
        echo -e "${RED}${BOLD}✘ Помилка пушу!${NC}"
        echo -e "${RED}  Перевір доступ до репозиторію та URL remote.${NC}"
        exit 1
    }
    echo -e "${GREEN}${BOLD}✔ Пуш успішний!${NC}"
fi

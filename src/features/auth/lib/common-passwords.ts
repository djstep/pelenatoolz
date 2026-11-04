/**
 * Частые пароли: их нельзя выбрать при регистрации и смене пароля. Файл используется и на сервере,
 * и в браузере (подсказка на форме), поэтому это небольшой модуль, а не текстовый файл.
 *
 * Источник: SecLists, Passwords/Common-Credentials/10k-most-common.txt
 * https://github.com/danielmiessler/SecLists (скачан 2026-11-04).
 * Оставлены только пароли от 10 символов (51 из 10001): более короткие и так отклоняются по длине.
 * Всё приведено к нижнему регистру. В конце добавлены русские варианты (62): их в списке нет.
 *
 * Лицензия списка SecLists:
 *
 * MIT License
 *
 * Copyright (c) 2018 Daniel Miessler
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  "1234567890",
  "fuck_inside",
  "deepthroat",
  "qwertyuiop",
  "basketball",
  "masterbate",
  "penetration",
  "masterbating",
  "unbelievable",
  "intercourse",
  "interacial",
  "ejaculation",
  "businessbabe",
  "experience",
  "contortionist",
  "cheerleaers",
  "housewifes",
  "gangbanged",
  "experienced",
  "transexual",
  "lockerroom",
  "absolutely",
  "masterbaiting",
  "masturbation",
  "pornographic",
  "knickerless",
  "enterprise",
  "scandinavian",
  "techniques",
  "manchester",
  "penetrating",
  "films+pic+galeries",
  "uncencored",
  "insertions",
  "fuckinside",
  "quant4307s",
  "christopher",
  "california",
  "cocksucker",
  "washington",
  "postov1000",
  "charlie123",
  "primetime21",
  "dragonball",
  "highlander",
  "playstation",
  "undertaker",
  "university",
  "1q2w3e4r5t",
  "motherfucker",
  "peternorth",
  "йцукенгшщз",
  "йцукенгшщзх",
  "йцукенгшщзхъ",
  "фывапролдж",
  "фывапролджэ",
  "ячсмитьбюё",
  "ячсмитьбю.",
  "йфяцычувскам",
  "йцукен1234",
  "йцукен12345",
  "йцукен123456",
  "йцукенйцукен",
  "фывафывафы",
  "фываолдж12",
  "пароль1234",
  "пароль12345",
  "пароль123456",
  "пароль1234567",
  "парольпароль",
  "мойпароль1",
  "мойпароль123",
  "новыйпароль",
  "новыйпароль1",
  "gfhjkm1234",
  "gfhjkm12345",
  "gfhjkm123456",
  "gfhjkmgfhjkm",
  "vjqgfhjkm1",
  "0987654321",
  "1111111111",
  "0000000000",
  "1234512345",
  "1122334455",
  "1q2w3e4r5t6y",
  "q1w2e3r4t5",
  "qwerty1234",
  "qwerty12345",
  "qwerty123456",
  "qwertyйцукен",
  "zaq12wsxcde3",
  "1qaz2wsx3edc",
  "qazwsxedcrfv",
  "йфяцычувс1",
  "админ12345",
  "админ123456",
  "admin12345",
  "admin123456",
  "россия1234",
  "россия12345",
  "москва1234",
  "москва12345",
  "любовь1234",
  "любовь12345",
  "солнышко12",
  "солнышко123",
  "кинофильм1",
  "кинофильм12",
  "кинофильм123",
  "пелена1234",
  "пелена12345",
  "pelena1234",
  "pelena12345",
]);

import { useId, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Alert } from "../ui/Alert.jsx";
import { Button } from "../ui/Button.jsx";
import { cx } from "../ui/cx.mjs";
import { useThemeMode } from "../hooks/useThemeMode.mjs";
import { Wordmark } from "../panel/Wordmark.jsx";
import { PASSWORD_LENGTH, sessionStore } from "./session.mjs";

const GUEST_ROLES = Object.freeze([
  { role: "student", label: "게스트 · 학생 모드" },
  { role: "admin", label: "게스트 · 관리자 모드" },
]);

// 첫 화면: 계정 로그인 하나와 게스트 단추 둘. 로그인하면 역할에 맞는 화면(학생·관리자)이 열린다.
// 게스트는 비밀번호 없이 바로 들어간다. 실패한 이유는 폼 위 알림 하나에 쓴다.
// leaving이면 뒤의 로딩 화면으로 녹아들며 사라진다.
export function LoginScreen({ store = sessionStore, leaving = false }) {
  useThemeMode();
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);
  const idField = useId();
  const passwordField = useId();
  const passwordHint = useId();
  const notice = store.getNotice();

  const signIn = async (kind, request) => {
    setPending(kind);
    setError(null);
    try {
      const result = await request();
      if (!result.ok) setError(result.message);
    } finally {
      setPending(null);
    }
  };

  return (
    <main
      data-qa="login-screen"
      inert={leaving ? "" : undefined}
      className={cx("fixed inset-0 z-[60] grid place-items-center overflow-y-auto px-4 py-8 text-ink transition-opacity duration-surface", leaving && "pointer-events-none opacity-0")}
    >
      <Card className="w-full max-w-sm shadow-dialog">
        <CardHeader className="gap-2 space-y-0">
          <Wordmark className="text-body font-semibold text-ink-muted" />
          <h2 className="text-title text-ink">로그인</h2>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {error && <Alert tone="danger" source="login" title={error} />}
          {!error && notice && <Alert tone="warning" source="login" title={notice} />}
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              signIn("account", () => store.login({ id: id.trim(), password }));
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor={idField}>아이디</Label>
              <Input
                id={idField}
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={id}
                onChange={(event) => setId(event.target.value)}
                className="h-11"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={passwordField}>비밀번호</Label>
              <Input
                id={passwordField}
                name="password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={PASSWORD_LENGTH}
                aria-describedby={passwordHint}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-11"
              />
              <p id={passwordHint} className="text-caption text-ink-muted">{`${PASSWORD_LENGTH}자리`}</p>
            </div>
            <Button type="submit" variant="primary" data-qa="login-submit" loading={pending === "account"} disabled={pending !== null && pending !== "account"}>
              로그인
            </Button>
          </form>
          <Separator />
          <section aria-labelledby="guest-heading" className="flex flex-col gap-3">
            <h3 id="guest-heading" className="text-caption text-ink-muted">로그인 없이 둘러보기</h3>
            {GUEST_ROLES.map(({ role, label }) => (
              <Button
                key={role}
                data-qa={`guest-${role}`}
                loading={pending === role}
                disabled={pending !== null && pending !== role}
                onClick={() => signIn(role, () => store.loginAsGuest(role))}
              >
                {label}
              </Button>
            ))}
          </section>
        </CardContent>
      </Card>
    </main>
  );
}

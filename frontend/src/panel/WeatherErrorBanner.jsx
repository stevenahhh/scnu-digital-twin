import { Alert } from "../ui/Alert.jsx";

// 기상 피드가 실패했을 때 패널 아래에 고정되는 알림 하나(원인과 다시 시도). 같은 원인을 다른 곳에 되풀이하지 않는다.
export function WeatherErrorBanner({ message, onRetry, busy }) {
  return (
    <div data-qa="weather-error-banner" className="mx-6 mb-6 mt-2 shrink-0">
      <Alert
        tone="danger"
        source="weather"
        title={message}
        message="연결이 돌아오면 기상 값이 다시 채워집니다"
        actions={[{ label: "다시 시도", onClick: () => !busy && onRetry() }]}
      />
    </div>
  );
}

import { Component } from "react";

export class PanelErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      const alert = (
        <div role="alert">
          <p>{this.props.message ?? "이 영역을 표시하는 중 문제가 발생했습니다"}</p>
          <button type="button" onClick={() => this.setState({ hasError: false })}>
            다시 시도
          </button>
        </div>
      );
      // 안내의 위치를 정해야 하는 곳(3D 지도)은 안내를 감쌀 틀의 클래스와 스타일을 넘긴다.
      if (!this.props.fallbackClassName) return alert;
      return (
        <div className={this.props.fallbackClassName} style={this.props.fallbackStyle}>
          {alert}
        </div>
      );
    }
    return this.props.children;
  }
}

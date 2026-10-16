import { Component } from "react";

export class PanelErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div role="alert">
          <p>{this.props.message ?? "이 영역을 표시하는 중 문제가 발생했습니다"}</p>
          <button type="button" onClick={() => this.setState({ hasError: false })}>
            다시 시도
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

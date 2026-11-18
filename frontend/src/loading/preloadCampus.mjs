import "../CityModel.jsx";
import { tapCampusModelBytes } from "./campusModelBytes.mjs";

// CityModel을 읽으면 모델 내려받기가 시작된다. 로그인 화면에 있는 동안 받아 두어 로그인 뒤 기다림을 줄인다.
tapCampusModelBytes();

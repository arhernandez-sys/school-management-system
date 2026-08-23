import React from 'react';
const S = (n) => () => React.createElement('div', { 'data-screen': n }, n);
export const GradeAssessmentsScreen = S('GradeAssessmentsScreen');
export const AssessmentGradingScreen = S('AssessmentGradingScreen');
export const MyGradesScreen = S('MyGradesScreen');
export const GradeRevisionsScreen = S('GradeRevisionsScreen');

/*
 * Copyright (C) 2024 Xibo Signage Ltd
 *
 * Xibo - Digital Signage - https://xibosignage.com
 *
 * This file is part of Xibo.
 *
 * Xibo is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 *
 * Xibo is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Xibo.  If not, see <http://www.gnu.org/licenses/>.
 */

// VIEWER Module

// Load templates
const LayerManager = require('../editor-core/layer-manager.js');
const DateFormatHelper = require('../helpers/date-format-helper.js');

const viewerTemplate = require('../templates/viewer.hbs');
const viewerRegionTemplate = require('../templates/viewer-region.hbs');
const viewerWidgetTemplate = require('../templates/viewer-widget.hbs');
const viewerLayoutPreview = require('../templates/viewer-layout-preview.hbs');
const viewerActionEditRegionTemplate =
  require('../templates/viewer-action-edit-region.hbs');
const loadingTemplate = require('../templates/loading.hbs');
const viewerElementTemplate = require('../templates/viewer-element.hbs');
const viewerElementGroupTemplate =
  require('../templates/viewer-element-group.hbs');
const viewerElementContentTemplate =
  require('../templates/viewer-element-content.hbs');
const viewerPlaylistControlsTemplate =
  require('../templates/viewer-playlist-controls.hbs');
const viewerActionLayoutDockTemplate =
  require('../templates/viewer-action-layout-dock.hbs');
const drawThrottle = 60;
const drawElementThrottle = 30;
const lineDef = {
  normalWidth: 3,
  hoverWidth: 3,
  plugSizeNormal: 2,
  plugSizeHover: 2,
  editedColor: '#EB7857',
  normalLightThemeColor: '#74ACFA',
  normalDarkThemeColor: '#1775F6',
  circularStartPos: {x: '50%', y: '0%'},
  circularEndPos: {x: '100%', y: '50%'},
  circularStartSocket: 'top',
  circularEndSocket: 'right',
  pathNormal: 'fluid',
  pathDock: 'grid',
  pathCircular: 'grid',
  gravityNormal: 'auto',
  gravityCircular: 'auto',
};

/**
 * Viewer contructor
 * @param {object} parent - Parent object
 * @param {object} container - the container to render the viewer to
 */
const Viewer = function(parent, container) {
  this.parent = parent;
  this.DOMObject = container;

  // First load
  this.reload = true;

  // Element dimensions inside the viewer container
  this.containerObjectDimensions = null;

  // If the viewer is currently playing the preview
  this.previewPlaying = false;

  // Theme ( light / dark)
  this.theme = 'light';
  this.themeColors = {
    light: '#f9f9f9',
    dark: '#333333',
  };

  // Moveable object
  this.moveable = null;
  this.moveableOptions = {
    snapToGrid: false,
    snapGridGap: 20,
    snapToBorders: false,
    snapToElements: false,
  };
  this.creatingAction = false;

  // Action lines
  this.actionLines = {};
  this.creatingAction = false;

  // Selecto
  this.selecto = null;

  // Layout orientation
  this.orientation = null;

  // Fullscreen mode flag
  this.fullscreenMode = false;

  // Action drop mode
  this.actionDropMode = false;

  // Initialize layer manager
  this.layerManager = new LayerManager(
    lD,
    this.parent.editorContainer.find('#layerManager'),
    this.DOMObject,
  );

  this.multiSelectActive = false;

  this.editingGroup = false;

  // Events for shift key
  addEventListener('keydown', (e) => {
    if (e.key === 'Shift' && this.editingGroup === false) {
      this.multiSelectActive = true;
      $('body').attr('multi-select-active', true);
    }
  });

  addEventListener('keyup', (e) => {
    if (e.key === 'Shift') {
      this.multiSelectActive = false;
      $('body').removeAttr('multi-select-active');
    }
  });
};

/**
 * Calculate element scale to fit inside the container
 * @param {object} object - original object to be rendered
 * @param {object} container - container to render the element to
 * @return {object} Object containing dimensions for the object
 */
Viewer.prototype.scaleObject = function(object, container) {
  // Get container dimensions
  const containerDimensions = {
    width: container.width(),
    height: container.height(),
  };

  // Get element dimensions
  const elementDimensions = {
    width: parseFloat(
      (object.dimensions) ? object.dimensions.width : object.width),
    height: parseFloat(
      (object.dimensions) ? object.dimensions.height : object.height),
    scale: 1,
    top: 0,
    left: 0,
  };

  // Calculate ratio
  const objectRatio = elementDimensions.width / elementDimensions.height;
  const containerRatio = containerDimensions.width / containerDimensions.height;

  // Calculate scale factor
  if (objectRatio > containerRatio) {
    // element is more "landscapish" than the container
    // Scale is calculated using width
    elementDimensions.scale =
      containerDimensions.width / elementDimensions.width;
  } else {
    // Same ratio or the container is the most "landscapish"
    // Scale is calculated using height
    elementDimensions.scale =
      containerDimensions.height / elementDimensions.height;
  }

  // Calculate new values for the element using the scale factor
  elementDimensions.width *= elementDimensions.scale;
  elementDimensions.height *= elementDimensions.scale;

  // Calculate top and left values to centre the element in the container
  elementDimensions.top =
    containerDimensions.height / 2 - elementDimensions.height / 2;
  elementDimensions.left =
    containerDimensions.width / 2 - elementDimensions.width / 2;

  return elementDimensions;
};

/**
 * Get layout orientation
 * @param {number} width
 * @param {number} height
 * @return {string} portrait | landscape
 * */
Viewer.prototype.getLayoutOrientation = function(width, height) {
  // Get layout orientation
  if (width < height) {
    return 'portrait';
  } else {
    return 'landscape';
  }
};

/**
 * Render viewer
 * @param {object} forceReload - Force reload
 * @param {object} targets - Reload only targets
*/
Viewer.prototype.render = function(forceReload = false, targets = {}) {
  const self = this;
  const renderOnlyTargets = (!$.isEmptyObject(targets));

  // Check background colour and set theme
  const hsvColor =
    (this.parent.layout.backgroundColor) ?
      Color(this.parent.layout.backgroundColor) : null;

  // If we don't have a background colour, set the theme to light
  // or if the background colour is too light or saturated
  // set the theme to dark
  if (
    hsvColor &&
    (
      (
        hsvColor.values.hsv[2] > 75 &&
        hsvColor.values.hsv[1] < 50
      ) ||
      hsvColor.values.hsv[2] > 90
    )
  ) {
    this.theme = 'dark';
  } else {
    this.theme = 'light';
  }

  // Refresh if it's not the reload
  if (!forceReload && !this.reload) {
    this.update();
    return;
  }

  // Clear moveable before replacing html to avoid memory leaks
  this.destroyMoveable();

  // Set reload to false
  this.reload = false;

  if (renderOnlyTargets) {
    const self = this;

    // Initialise moveable
    this.initMoveable();

    // Render targets
    $(targets).each((_idx, target) => {
      const $target = $(target);
      const targetType = $target.data('type');
      const createCanvas = function() {
        if (
          lD.layout.canvas &&
          self.DOMObject.find('.designer-region-canvas').length === 0
        ) {
          self.DOMObject.find('.layout-live-preview').append(
            `<div id="${lD.layout.canvas.id}" 
              class="designer-region-canvas"
              style="
                position:absolute;
                z-index: ${lD.layout.canvas.zIndex};">
              </div>`,
          );
        }
      };

      // Render single target
      if (
        targetType === 'widget' ||
        targetType === 'region'
      ) {
        const regionId = (targetType === 'region') ?
          $target.attr('id') :
          $target.data('widgetRegion');
        const regionToRender = lD.layout.regions[regionId];

        if (!regionToRender) {
          return;
        }

        // Add region template to viewer
        this.DOMObject.find('#regions').append(viewerRegionTemplate(
          regionToRender,
        ));

        // If it's a zone, just update the region dimensions
        if (
          targetType === 'region' &&
          $target.data('subType') === 'zone'
        ) {
          this.updateRegion(regionToRender);
        } else {
          this.renderRegion(regionToRender);
        }
      } else if (targetType === 'element') {
        createCanvas();

        // Get element
        const element = lD.getObjectByTypeAndId(
          'element',
          $target.attr('id'),
          'widget_' + $target.data('regionId') + '_' + $target.data('widgetId'),
        );

        // Render element
        this.renderElement(element, lD.layout.canvas);
      } else if (targetType === 'element-group') {
        createCanvas();

        // Get element group
        const elementGroup = lD.getObjectByTypeAndId(
          'element-group',
          $target.attr('id'),
          'widget_' + $target.data('regionId') + '_' + $target.data('widgetId'),
        );

        // Render all elements from group
        Object.values(elementGroup.elements).forEach((element) => {
          self.renderElement(element, lD.layout.canvas);
        });
      }

      // Delete temporary target
      if ($target.hasClass('viewer-temporary-object')) {
        $target.remove();
      }
    });
  } else {
    // Render full layout
    const $viewerContainer = this.DOMObject;

    // Clear temp data
    lD.common.clearContainer($viewerContainer);

    // Show loading template
    $viewerContainer.html(loadingTemplate());

    // When rendering, preview is always set to false
    this.previewPlaying = false;

    // Reset container properties
    $viewerContainer.css('background',
      (this.theme == 'dark') ? '#2c2d2e' : '#F3F8FF',
    );
    $viewerContainer.css('border', 'none');

    // Apply viewer scale to the layout
    this.containerObjectDimensions =
      this.scaleObject(lD.layout, $viewerContainer);

    this.orientation = this.getLayoutOrientation(
      this.containerObjectDimensions.width,
      this.containerObjectDimensions.height,
    );

    // Apply viewer scale to the layout
    const scaledLayout = lD.layout.scale($viewerContainer);

    const html = viewerTemplate({
      type: 'layout',
      renderLayout: true,
      containerStyle: 'layout-player',
      dimensions: this.containerObjectDimensions,
      layout: scaledLayout,
      renderCanvas: (!$.isEmptyObject(lD.layout.canvas)),
      trans: viewerTrans,
      theme: this.theme,
      orientation: this.orientation,
    });

    // Replace container html
    $viewerContainer.html(html);

    // Initialise moveable
    this.initMoveable();

    // Remove background image component if exists
    $viewerContainer.find('.layout-live-preview .layout-background-image')
      .remove();

    // Render background image or color to the preview
    if (lD.layout.backgroundImage === null) {
      $viewerContainer.find('.viewer-object')
        .css('background', lD.layout.backgroundColor);
    } else {
      // Get API link
      let linkToAPI = urlsForApi.layout.downloadBackground.url;
      // Replace ID in the link
      linkToAPI = linkToAPI.replace(':id', lD.layout.layoutId);

      // Append layout background image component
      const $layoutBgImage = $('<div class="layout-background-image"></div>');
      $layoutBgImage
        .css({
          background:
            'url(\'' + linkToAPI + '?preview=1&width=' +
            (lD.layout.width * this.containerObjectDimensions.scale) +
            '&height=' +
            (
              lD.layout.height *
              this.containerObjectDimensions.scale
            ) +
            '&proportional=0&layoutBackgroundId=' +
            lD.layout.backgroundImage + '\') top center no-repeat',
          backgroundSize: '100% 100%',
          backgroundColor: lD.layout.backgroundColor,
          zIndex: lD.layout.backgroundzIndex,
        });
      $layoutBgImage.appendTo($viewerContainer.find('.layout-live-preview'));
    }

    // Render viewer regions/widgets
    for (const regionIndex in lD.layout.regions) {
      if (
        lD.layout.regions.hasOwnProperty(regionIndex) &&
        lD.layout.regions[regionIndex].isViewable
      ) {
        this.renderRegion(lD.layout.regions[regionIndex]);
      }
    }

    // Render viewer canvas if it's not an empty object
    (!$.isEmptyObject(lD.layout.canvas)) && this.renderCanvas(lD.layout.canvas);
  }

  // Initalise selecto
  this.initSelecto();

  // Handle UI interactions
  this.handleUI();

  // Interactive controls
  if (lD.interactiveMode) {
    this.handleActionsUI();
  }

  if (lD.interactiveEditWidgetMode) {
    this.handleActionEditWidgetUI();
  }

  // If we are selecting an element in a group,
  // we need to put the group in edit mode
  if (
    this.parent.selectedObject.type == 'element' &&
    this.parent.selectedObject.groupId != undefined
  ) {
    this.editGroup(
      this.DOMObject.find(
        '.designer-element-group#' +
        this.parent.selectedObject.groupId,
      ),
      this.parent.selectedObject.elementId,
      true,
    );
  }

  // Refresh on window resize
  $(window).on('resize', _.debounce(function() {
    lD.viewer.update();
    if (lD.interactiveMode) {
      self.updateActionLine();
    }
  }, drawThrottle));

  // Update moveable
  this.updateMoveable(true);

  // Update moveable options
  this.updateMoveableOptions({
    savePreferences: false,
  });

  // Update moveable UI
  this.updateMoveableUI();

  // Initialise tooltips
  this.parent.common.reloadTooltips(this.DOMObject);
};

/**
 * Handle viewer UI
 */
Viewer.prototype.handleUI = function() {
  const self = this;
  const app = self.parent;
  const $viewerContainer = this.DOMObject;
  const $viewerContainerParent = $viewerContainer.parent();

  const calculatePosition = function(
    $droppableArea,
    event,
    ui,
  ) {
    const draggableDimensions = {
      width: ui.draggable.width(),
      height: ui.draggable.height(),
    };

    const droppableAreaPosition = {
      x: $droppableArea.offset().left,
      y: $droppableArea.offset().top,
    };

    // Get position, event location
    // adjusted with the viewer container
    // and the helper offset
    const position = {
      top: event.pageY -
        droppableAreaPosition.y -
        (draggableDimensions.height / 2),
      left: event.pageX -
        droppableAreaPosition.x -
        (draggableDimensions.width / 2),
    };

    // Scale value to original size ( and parse to int )
    position.top = parseInt(
      position.top /
      self.containerObjectDimensions.scale);
    position.left = parseInt(
      position.left /
      self.containerObjectDimensions.scale);

    return position;
  };

  // Handle droppable layout area
  const $droppableArea = $viewerContainer.find('.layout.droppable');
  $droppableArea.droppable({
    greedy: true,
    accept: (draggable) => {
      // Check target
      return lD.common.hasTarget(draggable, 'layout');
    },
    tolerance: 'pointer',
    drop: _.debounce(function(event, ui) {
      const position = calculatePosition(
        $droppableArea,
        event,
        ui,
      );

      lD.dropItemAdd(event.target, ui.draggable[0], position);
    }, 200),
  });

  // Handle droppable on the main container
  $viewerContainer.droppable({
    greedy: true,
    accept: (draggable) => {
      // Check target
      return lD.common.hasTarget(draggable, 'layout');
    },
    tolerance: 'pointer',
    drop: _.debounce(function(event, ui) {
      lD.dropItemAdd(event.target, ui.draggable[0]);
    }, 200),
  });

  // Handle droppable empty regions ( zones )
  this.DOMObject.find(
    '.designer-region.designer-region-zone',
  ).droppable({
    greedy: true,
    tolerance: 'pointer',
    accept: (draggable) => {
      // Check target
      return lD.common.hasTarget(draggable, 'zone');
    },
    drop: _.debounce(function(event, ui) {
      lD.dropItemAdd(event.target, ui.draggable[0]);
    }, 200),
  });

  // Handle droppable empty regions ( playlist )
  this.DOMObject.find(
    '.designer-region.designer-region-playlist',
  ).droppable({
    greedy: true,
    tolerance: 'pointer',
    accept: (draggable) => {
      // Check target ( not on action drop mode )
      return (!lD.viewer?.actionDropMode) &&
        lD.common.hasTarget(draggable, 'playlist');
    },
    drop: _.debounce(function(event, ui) {
      lD.dropItemAdd(event.target, ui.draggable[0]);
    }, 200),
  });

  // Handle droppable group
  this.DOMObject.find(
    '.designer-element-group',
  ).each((_idx, element) => {
    const $el = $(element);
    let elementsType = 'global';

    // Go through elements and check if there's any other than global
    $el.find('.designer-element').each((_idx, elementInGroup) => {
      const $elInGroup = $(elementInGroup);
      // Check element type
      if ($elInGroup.data('elementType') != 'global') {
        elementsType = $elInGroup.data('elementType');
        return false;
      }
    });

    $el.droppable({
      greedy: true,
      tolerance: 'pointer',
      accept: (draggable) => {
        // Validate if element is of the same
        // type as existing element or group

        // Check if element group is in edit mode
        if (!$el.hasClass('editing')) {
          return false;
        }

        return (
          lD.common.hasTarget(draggable, 'element') &&
          (
            $(draggable).data('dataType') == elementsType ||
            $(draggable).data('dataType') == 'global'
          )
        );
      },
      drop: _.debounce(function(event, ui) {
        const position = calculatePosition(
          $droppableArea,
          event,
          ui,
        );

        lD.dropItemAdd(event.target, ui.draggable[0], position);
      }, 200),
    });
  });

  // Handle droppable - image placeholder
  this.DOMObject.find(
    '.designer-element[data-sub-type="image_placeholder"]',
  ).each((_idx, element) => {
    const $el = $(element);

    $el.droppable({
      greedy: true,
      tolerance: 'pointer',
      accept: (draggable) => {
        return (
          (
            $(draggable).data('type') === 'media' &&
            $(draggable).data('subType') === 'image'
          ) || (
            $(draggable).data('type') === 'widget' &&
            $(draggable).data('subType') === 'image'
          )
        );
      },
      drop: _.debounce(function(event, ui) {
        lD.dropItemAdd(event.target, ui.draggable[0]);
      }, 200),
    });
  });

  // Handle click and double click
  let clicks = 0;
  let timer = null;
  $viewerContainerParent.find('.viewer-object-select')
    .off('mousedown.viewer')
    .on('mousedown.viewer', function(e) {
      e.stopPropagation();

      const shiftIsPressed = e.shiftKey;

      // Are we adding a card from the toolbar?
      const addingFromToolbar =
        !$.isEmptyObject(self.parent.toolbar.selectedCard);

      // Right click open context menu
      if (e.which == 3) {
        return;
      }

      const $trigger = $(e.target).hasClass('viewer-object-select') ?
        $(e.target) : $(e.currentTarget);

      // Interactive mode handling
      if (
        lD.interactiveMode
      ) {
        if (
          !app.readOnlyMode &&
          self.creatingAction === false &&
          $.isEmptyObject(app.actionManager.editing)
        ) {
          self.selectActionTrigger($trigger, e);
        }

        return;
      }

      const playlistEditorBtnClick = function(playlistId) {
        // Edit region if it's a playlist
        // Get region object
        const regionObject =
          lD.getObjectByTypeAndId('region', playlistId);
        // Open playlist editor
        lD.openPlaylistEditor(
          regionObject.playlists.playlistId,
          regionObject,
        );
      };

      const playlistInlineEditorBtnClick = function(
        childPlaylistId,
        regionId,
      ) {
        const regionObject =
          lD.getObjectByTypeAndId('region', regionId);
        lD.openPlaylistEditor(
          childPlaylistId,
          regionObject,
          false,
          true,
          true,
          regionObject.playlists.playlistId,
        );
      };

      const playlistPreviewBtnClick = function(playlistId, direction) {
        // Edit region if it's a playlist
        // Get region object
        const regionObject =
          lD.getObjectByTypeAndId('region', playlistId);

        if (direction === 'prev') {
          regionObject.playlistSeq--;
        } else {
          regionObject.playlistSeq++;
        }

        // Change the sequence
        if (regionObject.playlistSeq >
          regionObject.playlistCountOfWidgets
        ) {
          regionObject.playlistSeq = 1;
        } else if (regionObject.playlistSeq <= 0) {
          regionObject.playlistSeq = regionObject.playlistCountOfWidgets;
        }
        lD.viewer.renderRegion(regionObject);
      };

      // Get click position
      const clickPosition = {
        left: e.pageX -
          $viewerContainer.find('.layout.viewer-object-select').offset().left,
        top: e.pageY -
          $viewerContainer.find('.layout.viewer-object-select').offset().top,
      };

      // Scale value to original size ( and parse to int )
      clickPosition.top = parseInt(
        clickPosition.top /
        self.containerObjectDimensions.scale);
      clickPosition.left = parseInt(
        clickPosition.left /
        self.containerObjectDimensions.scale);

      // Click on layout or layout wrapper to clear selection
      // or add item to the layout
      if (
        (
          $trigger.hasClass('designer-region-zone') ||
          $trigger.hasClass('designer-region-playlist') ||
          $trigger.hasClass('designer-widget') ||
          $trigger.hasClass('designer-element')
        ) &&
        $trigger.hasClass('ui-droppable-active')
      ) {
        // Add item to the selected element
        lD.selectObject({
          target: $trigger,
          forceSelect: true,
          clickPosition: clickPosition,
        });
      } else if (
        $trigger.is('.designer-element-group.editing.ui-droppable-active')
      ) {
        // Add item to the selected element group
        lD.selectObject({
          target: $trigger,
          forceSelect: true,
          clickPosition: clickPosition,
        });
      } else if (
        $trigger.hasClass('layout-wrapper') ||
        $trigger.hasClass('layout')
      ) {
        // Clear selected object
        lD.selectObject({
          target: null,
          reloadViewer: false,
          clickPosition: $trigger.hasClass('layout') ? clickPosition : null,
        });
        self.selectObject();
      } else if (
        $trigger.hasClass('group-edit-btn')
      ) {
        self.editGroup(
          $trigger.parents('.designer-element-group'),
        );
      } else if (
        $trigger.hasClass('playlist-edit-btn')
      ) {
        // Edit subplaylist inside playlist
        if ($trigger.hasClass('subplaylist-inline-edit-btn')) {
          // Edit subplaylist inside playlist
          playlistInlineEditorBtnClick(
            $trigger.data('childPlaylistId'),
            $trigger.parents('.designer-region-playlist').attr('id'),
          );
        } else {
          // Edit region if it's a playlist
          playlistEditorBtnClick(
            $trigger.parents('.designer-region-playlist').attr('id'),
          );
        }
      } else if (
        $trigger.hasClass('playlist-preview-paging-prev')
      ) {
        // Somewhere in paging clicked.
        playlistPreviewBtnClick($trigger
          .parents('.designer-region-playlist').attr('id'), 'prev');
      } else if (
        $trigger.hasClass('playlist-preview-paging-next')
      ) {
        // Somewhere in paging clicked.
        playlistPreviewBtnClick($trigger
          .parents('.designer-region-playlist').attr('id'), 'next');
      } else {
        // Select elements inside the layout
        clicks++;

        // Single click
        if (clicks === 1 && e.which === 1) {
          timer = setTimeout(function() {
            // Single click action
            clicks = 0;

            if (
              $trigger.data('subType') === 'playlist' &&
              $trigger.hasClass('designer-region') &&
              (
                !$trigger.hasClass('selected') ||
                addingFromToolbar
              )
            ) {
              // If we're multi selecting, deselect all
              if (shiftIsPressed) {
                lD.selectObject({
                  reloadLayerManager: true,
                });
              } else {
                // Select region
                lD.selectObject({
                  target: $trigger,
                });
              }

              self.selectObject($trigger, shiftIsPressed);
            } else if (
              $trigger.find('.designer-widget').length > 0 &&
              (
                (
                  !$trigger.find('.designer-widget').hasClass('selected') &&
                  !$trigger.hasClass('selected')
                ) || addingFromToolbar
              )
            ) {
              // If we're multi selecting, deselect all
              if (shiftIsPressed) {
                lD.selectObject({
                  reloadLayerManager: true,
                });
              } else {
                // Select widget if exists
                lD.selectObject({
                  target: $trigger.find('.designer-widget'),
                  clickPosition: clickPosition,
                });
              }
              self.selectObject($trigger, shiftIsPressed);
            } else if (
              (
                $trigger.data('subType') === 'zone' ||
                (
                  $trigger.data('subType') === 'frame' &&
                  $trigger.is('.designer-region-frame.invalid-region')
                )
              ) &&
              $trigger.hasClass('designer-region') &&
              (
                !$trigger.hasClass('selected') ||
                addingFromToolbar
              )
            ) {
              // If we're multi selecting, deselect all
              if (shiftIsPressed) {
                lD.selectObject({
                  reloadLayerManager: true,
                });
              } else {
                // Select zone
                lD.selectObject({
                  target: $trigger,
                });
              }
              self.selectObject($trigger, shiftIsPressed);
            } else if (
              (
                $trigger.hasClass('designer-element') ||
                $trigger.hasClass('designer-element-group')
              ) &&
              (
                !$trigger.hasClass('selected') ||
                addingFromToolbar
              )
            ) {
              // If we're multi selecting, deselect all
              if (shiftIsPressed) {
                lD.selectObject({
                  reloadLayerManager: true,
                });
              } else {
                // Select element if exists
                lD.selectObject({
                  target: $trigger,
                  clickPosition: clickPosition,
                });
              }
              self.selectObject($trigger, shiftIsPressed);
            } else if (
              $trigger.hasClass('group-select-overlay') &&
              (
                !$trigger.parent().hasClass('selected') ||
                addingFromToolbar
              )
            ) {
              // If we're multi selecting, deselect all
              if (shiftIsPressed) {
                lD.selectObject({
                  reloadLayerManager: true,
                });
              } else {
                // Select element if exists
                lD.selectObject({
                  target: $trigger.parent(),
                  clickPosition: clickPosition,
                });
              }
              self.selectObject($trigger.parent(), shiftIsPressed);
            } else if (
              $trigger.hasClass('designer-element-group') &&
              $trigger.hasClass('editing')
            ) {
              // If we're editing, and select on group, deselect other elements
              lD.selectObject();
              self.selectObject(null, false, false);
            }
          }, 200);
        } else {
          // Double click action
          clearTimeout(timer);
          clicks = 0;

          // If we're adding from the toolbar
          // don't use double click
          if (addingFromToolbar) {
            return;
          }

          if (
            $trigger.data('subType') === 'playlist' &&
            !$trigger.hasClass('playlist-dynamic') &&
            $trigger.hasClass('editable')
          ) {
            // Edit region if it's a playlist
            playlistEditorBtnClick($trigger.attr('id'));
          } else if (
            // Select static widget region
            $trigger.data('subType') === 'frame' &&
            $trigger.hasClass('designer-region') &&
            $trigger.find('.designer-widget').length > 0
          ) {
            lD.selectObject({
              target: $trigger,
            });
            self.selectObject($trigger, shiftIsPressed);
          } else if (
            $trigger.hasClass('group-select-overlay') &&
            !$trigger.hasClass('editing')
          ) {
            self.editGroup(
              $trigger.parents('.designer-element-group'),
            );
          } else if (
            $trigger.data('type') === 'element' &&
            $trigger.data('subType') === 'text' &&
            $trigger.hasClass('editable') &&
            $trigger.hasClass('selected')
          ) {
            const element = lD.getObjectByTypeAndId(
              'element',
              $trigger.attr('id'),
              'widget_' + $trigger.data('regionId') +
                '_' + $trigger.data('widgetId'),
            );

            self.editText(element);
          } else if (
            $trigger.data('type') != undefined &&
            $trigger.data('subType') != undefined
          ) {
            // Move out from group editing
            lD.selectObject();
            self.selectObject(null, false, false);
          }
        }
      }
    }).on('dblclick', function(e) {
      // Cancel default double click
      e.preventDefault();
    }).children(
      ':not(.message-container):not(.message-container *)' +
      ':not(.slot):not(.slot *)',
    ).on('mousedown dblclick', function(e) {
      // Cancel default click
      e.stopPropagation();
    }).contextmenu(function(ev) {
      // If target has class group-select-overlay
      // set target to the parent
      if ($(ev.target).hasClass('group-select-overlay')) {
        ev.target = $(ev.target).parent()[0];
      }

      // Context menu
      if (
        $(ev.target).is('.editable, .deletable, .permissionsModifiable') &&
        !$(ev.target).hasClass('contextMenuOpen') &&
        !(
          $(ev.target).hasClass('designer-element-group') &&
          $(ev.target).hasClass('editing')
        )
      ) {
        // Open context menu
        lD.openContextMenu(ev.target, {
          x: ev.pageX,
          y: ev.pageY,
        });

        // Mark context menu as open for the target
        $(ev.target).addClass('contextMenuOpen');
      }
      // Prevent browser menu to open
      return false;
    });


  // Handle mouse up for creating actions
  $viewerContainerParent
    .off('mouseup.viewer')
    .on('mouseup.viewer', function(e) {
      let $target = $(e.target);

      // If not in interactive mode, cancel event
      if (!lD.interactiveMode) {
        $viewerContainerParent.off('mouseup.viewer');
        return;
      }

      // If we're not in create action mode, stop
      if (self.creatingAction === false) {
        return;
      }

      const trigger = self.actionLines['action_line_temp'].trigger;
      let targetType = $target.data('type');

      // If target is widget, move to its region
      if (targetType === 'widget') {
        $target = $target.parent();
        targetType = $target.data('type');
      }

      let targetId = $target.data(targetType + 'Id');
      let actionType = 'next'; // Default to next
      let layoutCode;

      // If target is not valid, and we're creating line
      // stop and remove it, keep event
      if (
        self.creatingAction &&
        !(
          $target.is('.viewer-object-select') ||
          $target.is('.action-screen-helper')
        ) || targetId === undefined
      ) {
        // Remove temp line
        self.removeActionLine('action_line_temp');

        // Finish creating action
        self.stopCreatingActionLine();

        return;
      }

      e.stopPropagation();

      // Get default action type based on the target
      // If it's frame and not playlist, default to navigate to widget
      if ($target.data('subType') === 'frame') {
        actionType = 'navWidget';
      } else if ($target.data('subType') === 'layout-code') {
        actionType = 'navLayout';
        layoutCode = targetId;
        targetId = app.layout.layoutId;
      }

      app.propertiesPanel.createEditAction({
        actionType: actionType,
        source: trigger.type,
        sourceId: trigger.id,
        target: targetType,
        targetId: targetId,
        layoutCode: layoutCode,
        newAction: true,
      });

      // Update target
      self.updateActionLineTargets(
        'action_line_temp',
        self.actionLines['action_line_temp'].trigger,
        {
          type: targetType,
          id: targetId,
        },
      );

      // Update all action lines
      self.updateActionLine();

      // Finish creating action, and remove trigger selection
      self.stopCreatingActionLine(true);
    });

  // Handle fullscreen button
  $viewerContainer.siblings('#fullscreenBtn').off('click')
    .on('click', function() {
      this.reload = true;
      this.toggleFullscreen();
    }.bind(this));

  // Handle layer manager button
  $viewerContainer.siblings('#layerManagerBtn')
    .off('click').on('click', function() {
      this.layerManager.setVisible();
    }.bind(this));

  // Handle snap buttons
  $viewerContainerParent.find('#snapToGrid')
    .off('click').on('click', function() {
      this.moveableOptions.snapToGrid = !this.moveableOptions.snapToGrid;

      // Turn off snap to element if grid is on
      if (this.moveableOptions.snapToGrid) {
        this.moveableOptions.snapToElements = false;
      }

      // Update moveable options
      this.updateMoveableOptions();

      // Update moveable UI
      this.updateMoveableUI();
    }.bind(this));

  $viewerContainerParent.find('#snapToBorders')
    .off('click').on('click', function() {
      this.moveableOptions.snapToBorders = !this.moveableOptions.snapToBorders;

      // Update moveable options
      this.updateMoveableOptions();

      // Update moveable UI
      this.updateMoveableUI();
    }.bind(this));

  $viewerContainerParent.find('#snapToElements')
    .off('click').on('click', function() {
      this.moveableOptions.snapToElements =
        !this.moveableOptions.snapToElements;

      // Turn off snap to grid if element is on
      if (this.moveableOptions.snapToElements) {
        this.moveableOptions.snapToGrid = false;
      }

      // Update moveable options
      this.updateMoveableOptions();

      // Update moveable UI
      this.updateMoveableUI();
    }.bind(this));

  const updateMoveableWithDebounce = _.debounce(function() {
    self.updateMoveableOptions();
  }, 1000);
  $viewerContainerParent.find('.snap-to-grid-value')
    .off().on('input', function(ev) {
      let gridValue = Number($(ev.currentTarget).val());

      if (gridValue < 1) {
        gridValue = 1;
        $(ev.currentTarget).val(1).trigger('select');
      }

      self.moveableOptions.snapGridGap = gridValue;

      // Update moveable options
      updateMoveableWithDebounce();
    });
};

/**
 * Update Viewer
 */
Viewer.prototype.update = function() {
  const $viewerContainer = this.DOMObject;
  const $viewElement = $viewerContainer.find('.viewer-object');
  const self = this;

  // Hide viewer element
  $viewElement.hide();

  // Apply viewer scale to the layout
  this.containerObjectDimensions =
    this.scaleObject(lD.layout, $viewerContainer);

  // Apply viewer scale to the layout
  lD.layout.scale($viewerContainer);

  $viewElement.css({
    width: this.containerObjectDimensions.width,
    height: this.containerObjectDimensions.height,
    top: this.containerObjectDimensions.top,
    left: this.containerObjectDimensions.left,
  });

  // Show viewer element
  $viewElement.show();

  // Render preview regions/widgets
  for (const regionIndex in lD.layout.regions) {
    if (lD.layout.regions.hasOwnProperty(regionIndex)) {
      this.updateRegion(lD.layout.regions[regionIndex]);
    }
  }

  // Render preview elements
  for (const canvasWidget in lD.layout.canvas.widgets) {
    if (lD.layout.canvas.widgets.hasOwnProperty(canvasWidget)) {
      const widgetElements = lD.layout.canvas.widgets[canvasWidget].elements;

      for (const elementIndex in widgetElements) {
        if (widgetElements.hasOwnProperty(elementIndex)) {
          this.updateElement(widgetElements[elementIndex]);
          self.renderElement(
            widgetElements[elementIndex],
            lD.layout.canvas,
          );
        }
      }
    }
  }

  // Update action helper if exists
  $viewElement.find('.designer-region-drawer').each(function() {
    this.updateRegion(
      lD.layout.drawer,
      ($viewElement.data('target') == 'layout'),
    );
  }.bind(this));

  // If we are selecting an element in a group,
  // we need to put the group in edit mode
  if (
    self.parent.selectedObject.type == 'element' &&
    self.parent.selectedObject.groupId != undefined
  ) {
    self.editGroup(
      self.DOMObject.find(
        '.designer-element-group#' +
        self.parent.selectedObject.groupId,
      ),
      self.parent.selectedObject.elementId,
      true,
    );
  }

  // Update moveable
  this.updateMoveable(true);

  // Update moveable options
  this.updateMoveableOptions({
    savePreferences: false,
  });
};

/**
 * Render widget in region container
 * @param {object} region - region object
 * @param {object} widgetToLoad - widget object to render
 * @return {jqXHR} - ajax request object
 */
Viewer.prototype.renderRegion = function(
  region,
  widgetToLoad = null,
) {
  const self = this;
  const $container = this.DOMObject.find(`#${region.id}`);
  const isPlaylist = region.subType == 'playlist';
  const isZone = region.subType == 'zone';

  // Get first widget of the region
  const widget = (widgetToLoad) ?
    widgetToLoad :
    region.widgets[Object.keys(region.widgets)[0]];

  // If region is selected, update moveable
  if (region.selected) {
    this.selectObject($container);
  }

  // Update region type and class
  $container.attr('data-sub-type', region.subType)
    .removeClass(
      'designer-region-zone ' +
      'designer-region-frame ' +
      'designer-region-playlist',
    ).addClass('designer-region-' + region.subType);

  // If there's no widget, return
  if (!widget && !isPlaylist) {
    // If it's not a zone, we need to mark region as an error
    // so it can be highlighted
    if (!isZone) {
      $container.addClass('invalid-region');
      $container.append(
        '<p class="invalid-region-message">' +
        viewerTrans.invalidRegion +
        '</p>');
    }
    return;
  }

  // If there was still a render request, abort it
  if (
    this.renderRequest != undefined &&
    this.renderRequest.target == $container
  ) {
    this.renderRequest.abort('requestAborted');
  }

  // Show loading
  $container.html(loadingTemplate());

  // Apply scaling
  const containerObjectDimensions = {
    width: $container.width(),
    height: $container.height(),
  };

  // Get current sequence
  region.playlistSeq = region.playlistSeq || 1;

  // Get request path
  let requestPath = urlsForApi.region.preview.url;
  requestPath = requestPath.replace(
    ':id',
    region['regionId'],
  );

  requestPath +=
    '?width=' + containerObjectDimensions.width +
    '&height=' + containerObjectDimensions.height;

  // If it's not a playlist, add widget to request
  if (!isPlaylist) {
    requestPath += '&widgetId=' + widget['widgetId'];
  } else {
    requestPath += '&seq=' + region.playlistSeq;
  }

  // Get HTML for the given element from the API
  this.renderRequest = {
    target: $container,
  };

  this.renderRequest.request = $.get(requestPath).done(function(res) {
    // Clear request var after response
    self.renderRequest = undefined;

    // Prevent rendering null html
    if (!res.success) {
      toastr.error(res.message);
      $container.html(res.message);
      return;
    }

    const options = {
      res: res,
      regionId: region['id'],
      trans: viewerTrans,
    };

    if (isPlaylist) {
      $.extend(true, options, {
        objectType: 'playlist',
      });
    } else {
      $.extend(true, options, {
        id: widget.id,
        widgetId: widget.widgetId,
        objectType: (widget.type + '_' + widget.subType),
        editable: widget.isEditable,
        parentId: widget.regionId,
        selected: widget.selected,
        drawerWidget: widget.drawerWidget,
      });
    }

    $.extend(toolbarTrans, topbarTrans);

    // Send isEditor flag with options.res.html for the iframe
    if (!isPlaylist && options.res.html) {
      options.res.html =
        options.res.html.replace('?preview=1', '?preview=1&isEditor=1');
    }

    // Replace container html
    const html = viewerWidgetTemplate(options);

    // Clear temp data
    lD.common.clearContainer($container);

    // Append layout html to the container div
    $container.html(html);

    // If it's (an editable) playlist, add some playlist controls
    if (
      isPlaylist &&
      region.isEditable
    ) {
      region.playlistCountOfWidgets = res.extra && res.extra.countOfWidgets ?
        res.extra.countOfWidgets : 1;

      const appendOptions = {
        titleEdit: viewerTrans.editPlaylist,
        seq: region.playlistSeq,
        countOfWidgets: region.playlistCountOfWidgets,
        isEmpty: res.extra && res.extra.empty,
        trans: viewerTrans,
        canEditPlaylist: false,
        isDynamicPlaylist: false,
      };

      // Append playlist controls using appendOptions
      const appendPlaylistControls = function() {
        // Mark playlist container as global-editable or dynamic
        $container.toggleClass(
          'playlist-global-editable',
          appendOptions.canEditPlaylist,
        );
        $container.toggleClass(
          'playlist-dynamic',
          appendOptions.isDynamicPlaylist,
        );

        // Append playlist controls to container
        $container.append(viewerPlaylistControlsTemplate(appendOptions));
      };

      // If it's playlist with a single subplaylist widget
      if (
        Object.keys(region.widgets).length === 1 &&
        Object.values(region.widgets)[0].subType === 'subplaylist' &&
        Object.values(region.widgets)[0].getOptions().subPlaylists
      ) {
        // Get assigned subplaylists
        const subplaylists =
          JSON.parse(
            Object.values(region.widgets)[0].getOptions().subPlaylists,
          );

        // If there's only one playlist, get permissions
        if (subplaylists.length === 1) {
          const subPlaylistId = subplaylists[0].playlistId;
          $.ajax({
            method: 'GET',
            url: urlsForApi.playlist.get.url +
              '?playlistId=' + subplaylists[0].playlistId,
            success: function(_res) {
              // User has permissions
              if (_res.data && _res.data.length > 0) {
                // Check if playlist is dynamic
                if (_res.data[0].isDynamic === 1) {
                  appendOptions.isDynamicPlaylist = true;
                } else {
                  // If it's not dynamic, enable editing
                  appendOptions.canEditPlaylist = true;
                  appendOptions.canEditPlaylistId = subPlaylistId;
                }
              }

              // Append playlist controls
              appendPlaylistControls();
            },
            error: function(_res) {
              console.error(_res);
              // Still append playlist controls
              appendPlaylistControls();
            },
          });
        } else {
          // Append playlist controls
          appendPlaylistControls();
        }
      } else {
        // Append playlist controls
        appendPlaylistControls();
      }
    }

    // If widget is selected, update moveable for the region
    if (widget && widget.selected) {
      this.selectObject($container);
    }

    // Select droppables in the region
    let $droppables = $container.find('.droppable');

    // Check if region is also a droppable
    // if so, add it to the droppables
    if ($container.hasClass('droppable')) {
      $droppables = $.merge($droppables, $container);
    }

    // Init droppables
    $droppables.droppable({
      greedy: true,
      tolerance: 'pointer',
      accept: function(draggable) {
        // Get type ( if region, get subType )
        const dataType =
          ($(this).hasClass('designer-region')) ?
            $(this).data('subType') :
            $(this).data('type');

        // Check target
        return lD.common.hasTarget(draggable, dataType);
      },
      drop: _.debounce(function(event, ui) {
        lD.dropItemAdd(event.target, ui.draggable[0]);
      }, 200),
    });

    // If inline editor is on, show the controls for it
    // ( fixing asyc load problem )
    if (lD.propertiesPanel.inlineEditor) {
      // Show inline editor controls
      this.showInlineEditor();
    }

    // Force scale region container
    // by updating region
    self.updateRegion(region);
  }.bind(this)).fail(function(res) {
    // Clear request var after response
    self.renderRequest = undefined;

    if (res.statusText != 'requestAborted') {
      toastr.error(errorMessagesTrans.previewFailed);
      $container.html(errorMessagesTrans.previewFailed);
    }
  });

  // Return request
  return this.renderRequest;
};

/** Render region with debounce */
Viewer.prototype.renderRegionDebounced = _.debounce(
  function(region, widgetToLoad = null) {
    lD.viewer.renderRegion(region, widgetToLoad);
  },
  500,
);

/**
 * Update element with throttle
 */
Viewer.prototype.updateElementWithThrottle = _.throttle(function(
  element,
) {
  lD.viewer.updateElement(element);
}, drawElementThrottle);

/**
 * Update element
 * @param {object} element
 */
Viewer.prototype.updateElement = function(
  element,
) {
  const $container = lD.viewer.DOMObject.find(`#${element.elementId}`);

  // Get real elements from the structure
  const realElement =
    lD.getObjectByTypeAndId(
      'element',
      element.elementId,
      'widget_' + element.regionId + '_' + element.widgetId,
    );

  // Calculate scaled dimensions
  realElement.scaledDimensions = {
    height: realElement.height * lD.viewer.containerObjectDimensions.scale,
    left: realElement.left * lD.viewer.containerObjectDimensions.scale,
    top: realElement.top * lD.viewer.containerObjectDimensions.scale,
    width: realElement.width * lD.viewer.containerObjectDimensions.scale,
  };

  // Update element index
  $container.css({
    'z-index': realElement.layer,
  });

  // Update element content
  lD.viewer.renderElementContent(
    realElement,
    lD.viewer.layerManager.renderWithDebounce, // callback
  );
};

/**
 * Update element group with throttle
 */
Viewer.prototype.updateElementGroupWithThrottle = _.throttle(function(
  elementGroup,
) {
  lD.viewer.updateElementGroup(elementGroup);
}, drawElementThrottle);

/**
 * Update element group
 * @param {object} elementGroup
 */
Viewer.prototype.updateElementGroup = function(
  elementGroup,
) {
  // Update slot
  const $groupContainer = lD.viewer.DOMObject.find(`#${elementGroup.id}`);
  $groupContainer.find('.slot span').html((Number(elementGroup.slot) + 1));

  // Update all elements
  Object.values(elementGroup.elements).forEach((element) => {
    const $container = lD.viewer.DOMObject.find(`#${element.elementId}`);

    // Calculate scaled dimensions
    element.scaledDimensions = {
      height: element.height * lD.viewer.containerObjectDimensions.scale,
      left: (element.left - elementGroup.left) *
        lD.viewer.containerObjectDimensions.scale,
      top: (element.top - elementGroup.top) *
        lD.viewer.containerObjectDimensions.scale,
      width: element.width * lD.viewer.containerObjectDimensions.scale,
    };

    // Update element index
    $container.css({
      height: element.scaledDimensions.height,
      left: element.scaledDimensions.left,
      top: element.scaledDimensions.top,
      width: element.scaledDimensions.width,
    });

    // Update element content
    lD.viewer.renderElementContent(
      element,
      lD.viewer.layerManager.renderWithDebounce, // callback
    );
  });
};

/**
 * Update element group
 * @param {object} elementGroup
 */
Viewer.prototype.updateElementGroupLayer = _.throttle(function(
  elementGroup,
  layer,
) {
  const $container = lD.viewer.DOMObject.find(`#${elementGroup.id}`);

  // Update element index
  $container.css({
    'z-index': (layer) ? layer : elementGroup.layer,
  });
}, drawThrottle);

/**
 * Update region with throttle
 */
Viewer.prototype.updateRegionWithThrottle = _.throttle(function(
  region,
  changed = false,
) {
  lD.viewer.updateRegion(region, changed);
}, drawThrottle);

/**
 * Update Region
 * @param {object} region - region object
 * @param {boolean} changed - if region was changed
 */
Viewer.prototype.updateRegion = function(
  region,
  changed = false,
) {
  const $container = lD.viewer.DOMObject.find(`#${region.id}`);

  // If drawer and has target region, set dimensions
  // to be the same as it
  if (
    region.isDrawer &&
    $container.data('targetRegionDimensions') != undefined
  ) {
    region.dimensions = $container.data('targetRegionDimensions');
    region.zIndex = $container.data('targetRegionzIndex');
  }

  // Calculate scaled dimensions
  region.scaledDimensions = {
    height: region.dimensions.height *
      lD.viewer.containerObjectDimensions.scale,
    left: region.dimensions.left * lD.viewer.containerObjectDimensions.scale,
    top: region.dimensions.top * lD.viewer.containerObjectDimensions.scale,
    width: region.dimensions.width * lD.viewer.containerObjectDimensions.scale,
  };

  // Update region container dimensions
  $container.css({
    height: region.scaledDimensions.height,
    left: region.scaledDimensions.left,
    top: region.scaledDimensions.top,
    width: region.scaledDimensions.width,
  });

  // Update z index if set
  let redrawLayerManager = false;
  if (region.zIndex != undefined) {
    $container.css('z-index', region.zIndex);
    redrawLayerManager = true;
  }

  // Update region content
  if (region.subType === 'playlist' && changed) {
    lD.viewer.renderRegionDebounced(region);
  } else {
    lD.viewer.updateRegionContent(region, changed);
  }

  // Redraw layer manager to reflect the layer change
  if (redrawLayerManager) {
    lD.viewer.layerManager.render();
  }

  // If region is selected, but not on the container, do it
  if (region.selected && !$container.hasClass('selected')) {
    lD.viewer.selectObject($container);

    // Update bottom bar
    lD.bottombar.render(region);
  }

  // Always update moveable
  lD.viewer.updateMoveable();
};

/**
 * Render canvas in the viewer
 * @param {object} canvas - canvas object
 */
Viewer.prototype.renderCanvas = function(
  canvas,
) {
  // Render widgets
  for (const widgetId in canvas.widgets) {
    if (canvas.widgets.hasOwnProperty(widgetId)) {
      const widget = canvas.widgets[widgetId];

      // Get elements from widget
      for (const elementId in widget.elements) {
        if (widget.elements.hasOwnProperty(elementId)) {
          const element = widget.elements[elementId];

          // Render element
          this.renderElement(element, canvas);
        }
      }
    }
  }
};

/**
 * Render element
 * @param {object} element - element object
 * @param {object} canvas - canvas object
 */
Viewer.prototype.renderElement = function(
  element,
  canvas,
) {
  const self = this;

  // If element is not viewable, don't render
  if (!element.isViewable) {
    return;
  }

  // Get canvas region container
  const $canvasRegionContainer = this.DOMObject.find(`#${canvas.id}`);

  // Scale element based on viewer scale
  const viewerScale = this.containerObjectDimensions.scale;
  const elementRenderDimensions = {
    height: element.height * viewerScale,
    left: element.left * viewerScale,
    top: element.top * viewerScale,
    width: element.width * viewerScale,
    rotation: element.rotation,
    // If layer is negative, set it to 0
    layer: element.layer < 0 ? 0 : element.layer,
  };

  // If element belongs to a group, adjust top and left
  if (element.groupId) {
    elementRenderDimensions.left -=
      element.group.left * viewerScale;

    elementRenderDimensions.top -=
      element.group.top * viewerScale;
  }

  // Render element container
  const $newElement = $(viewerElementTemplate({
    element: element,
    dimensions: elementRenderDimensions,
  }));

  // If elements has a group, get group container
  let $groupContainer;
  if (element.groupId) {
    // Create group container if it doesn't exist
    if (
      $canvasRegionContainer.find(`#${element.groupId}`).length == 0
    ) {
      // Get element group type
      const groupElements = Object.values(element.group.elements);
      let elementGroupType = 'global';

      groupElements.every((el) => {
        // If we found a type other than global
        // save it and stop
        if (el.elementType != 'global') {
          elementGroupType = el.elementType;
          // Break the loop
          return false;
        }

        // Keep going
        return true;
      });

      $canvasRegionContainer.append(
        viewerElementGroupTemplate({
          element: element,
          elementGroupType: elementGroupType,
          trans: viewerTrans,
        }),
      );
    }

    // Get group container
    $groupContainer = $canvasRegionContainer.find(
      `#${element.groupId}`,
    );

    // Get group object
    const group = lD.getObjectByTypeAndId(
      'element-group',
      element.groupId,
      'widget_' + element.regionId + '_' + element.widgetId,
    );

    // If group is selected, add selected class
    if (group.selected) {
      this.selectObject($groupContainer);
    }

    // If group has source, add it to the container
    // or update it
    if (
      group.slot != undefined &&
      group.slot != null
    ) {
      const $slot = $groupContainer.find('.slot');
      if ($slot.length > 0) {
        $slot.find('span').html((Number(group.slot) + 1));
      } else {
        $groupContainer.append(
          '<div class="slot" title="' +
            propertiesPanelTrans.dataSlot +
          '">#' +
          '<span>' + (Number(group.slot) + 1) + '</span>' +
          '</div>');
      }
    }
  }

  // Append element html to the canvas region container
  // if it doesn't exist, otherwise replace it
  if ($canvasRegionContainer.find(`#${element.elementId}`).length) {
    $canvasRegionContainer.find(`#${element.elementId}`)
      .replaceWith($newElement);
  } else {
    // If element has group, append it to the group container
    if (element.groupId) {
      // Add element to group container
      $groupContainer.find('.designer-element-group-elements')
        .append($newElement);
    } else {
      // Otherwise append it to the canvas region container
      $canvasRegionContainer.append($newElement);
    }
  }

  // If we have a group container, set its dimensions
  if (element.groupId && $groupContainer) {
    // Set dimensions
    $groupContainer.css({
      position: 'absolute',
      height: element.group.height * viewerScale,
      left: element.group.left * viewerScale,
      top: element.group.top * viewerScale,
      width: element.group.width * viewerScale,
    });

    // Update element group index
    if (element.group.layer != undefined) {
      $groupContainer.css({
        'z-index': element.group.layer,
      });
    }
  }

  // Render element content and handle interactions after
  this.renderElementContent(element, () => {
    // Handle viewer interactions
    self.handleUI();
  });
};

/**
 * Update element content
 * @param {Object} element
 * @param {Function} callback
 */
Viewer.prototype.renderElementContent = function(
  element,
  callback = null,
) {
  const self = this;
  // Get element container
  const $elementContainer = this.DOMObject.find(`#${element.elementId}`);

  // Get asset container to add element assets
  const $assetContainer =
    this.parent.editorContainer.find('#asset-container');

  // Get parent widget
  const parentWidget = lD.getObjectByTypeAndId(
    'widget',
    'widget_' + element.regionId + '_' + element.widgetId,
    'canvas',
  );

  // Get element template ( most of the time
  // template will be already loaded/cached )
  element.getTemplate().then((template) => {
    // Create and render HBS template from template
    const stencil = template.stencil ?
      template.stencil : template.parent.stencil;
    let hbsTemplate = Handlebars.compile(
      (stencil?.hbs) ?
        stencil.hbs :
        '',
    );

    // Add style to canvas region, if it's still not added
    if (
      $assetContainer.find('[data-style-template=' + template.templateId + ']')
        .length === 0
    ) {
      function scopeCSS(css, scope) {
        return css
          .split('}')
          .map((rule) => rule.trim() ? `${scope} ${rule.trim()}}` : '')
          .join('\n')
          .trim();
      }

      const styleTemplate = Handlebars.compile(
        (stencil?.style) ?
          scopeCSS(
            stencil.style,
            '[data-style-scope="' +
            template.type + '_' + template.dataType +
            '__' + template.templateId + '"]',
          ) : '',
      );

      $(`<style data-style-template="${template.templateId}">`)
        .html(styleTemplate()).prependTo($assetContainer);
    }

    // Add JS and CSS assets if not added already
    template.assets.forEach((asset) => {
      const assetURL = urlsForApi.module.assetDownload.url;
      if (
        asset.autoInclude &&
        asset.mimeType === 'text/css' &&
        $assetContainer.find('[data-asset-id=' + asset.id + ']').length === 0
      ) {
        $(`<link rel="stylesheet"
          href="${assetURL.replace(':assetId', asset.id)}"
          data-asset-id="${asset.id}" media="screen"/>`)
          .prependTo($assetContainer);
      }

      if (
        asset.autoInclude &&
        asset.mimeType === 'text/javascript' &&
        $assetContainer.find('[data-asset-id=' + asset.id + ']').length === 0
      ) {
        $(`<script type="text/javascript"
          src="${assetURL.replace(':assetId', asset.id)}"
          data-asset-id="${asset.id}"></script>`)
          .prependTo($assetContainer);
      }
    });

    // If element dimensions are not set, set them
    // to the extended template, if it exists
    // or to hardcoded values
    if (!element.width || !element.height) {
      if (template.startWidth && template.startHeight) {
        element.width = template.startWidth;
        element.height = template.startHeight;
      } else if (template.parent) {
        element.width = template.parent.startWidth;
        element.height = template.parent.startHeight;
      } else {
        element.width = 100;
        element.height = 100;
      }

      // Render element again
      self.renderElement(element, lD.layout.canvas);
      return;
    }

    // If we have slot, show it as a val+1
    if (
      element.slot != undefined &&
      element.slot != null
    ) {
      element.slotView = Number(element.slot) + 1;
    }

    // If rotatable is updated, update moveable
    if (template.canRotate != undefined) {
      element.canRotate = template.canRotate;
      $elementContainer.data('canRotate', element.canRotate);

      self.moveable.rotatable = element.canRotate;
    }

    // Render element with template
    $elementContainer.html($(viewerElementContentTemplate({
      element: element,
      template: template,
      scale: self.containerObjectDimensions.scale,
      originalWidth: element.width,
      originalHeight: element.height,
      trans: propertiesPanelTrans,
    })));

    // Get element properties
    element.getProperties().then((properties) => {
      // Parent widget sendToElement properties
      const sendToElementProperties =
        parentWidget.getSendToElementProperties();

      // Convert properties to object with id and value
      const convertedProperties = {};
      let hasCircleOutline = false;
      for (const key in properties) {
        if (properties.hasOwnProperty(key)) {
          const property = properties[key];

          // If the widget is sending the property
          // to the element, use that value instead
          if (sendToElementProperties[property.id] != undefined) {
            property.value = sendToElementProperties[property.id];
          }

          // Convert checkbox values to boolean
          if (property.type === 'checkbox') {
            property.value = Boolean(Number(property.value));
          }

          // Add property to properties object
          convertedProperties[property.id] = (property.value == undefined) ?
            property.default : property.value;

          // Convert variant=dateFormat from PHP to Moment format
          if (property.id === 'dateFormat' &&
            convertedProperties.hasOwnProperty(property.id)) {
            convertedProperties[property.id] = DateFormatHelper
              .convertPhpToMomentFormat(String(
                convertedProperties[property.id],
              ));
          }

          // Calculate circle radius based on outlineWidth
          if (element.id === 'circle') {
            if (property.id === 'outline') {
              hasCircleOutline = property.value;
            }

            if (property.id === 'outlineWidth') {
              convertedProperties.circleRadius = hasCircleOutline ?
                50 - (property.value / 4) : 50;
            }
          }
        }
      }

      // Handle override property values
      if (
        stencil &&
        template.extends?.override &&
        template.extends?.with
      ) {
        // Compile template
        hbsTemplate = Handlebars.compile(stencil.hbs);
      }

      // Get element data from widget
      element.getData().then((elementData) => {
        const elData = elementData?.data;
        const meta = elementData?.meta;

        // Validate widget
        self.validateElement(element);

        // Check all data elements and make replacements
        for (const key in elData) {
          if (elData.hasOwnProperty(key)) {
            const data = elData[key];

            // Check if data needs to be replaced
            if (
              String(data) &&
              String(data).match(DateFormatHelper.macroRegex) !== null
            ) {
              // Replace macro with current date
              elData[key] = DateFormatHelper.composeUTCDateFromMacro(data);
            }
          }
        }

        // Add widget data to properties
        convertedProperties.data = elData;

        // Send uniqueID
        convertedProperties.uniqueID = element.elementId;

        // Send element props
        convertedProperties.prop = element;

        const extendOverrideKey = template.extends?.override || null;
        const extendWithDataKey = template.extends?.with ?
          transformer.getExtendedDataKey(template.extends.with) : null;
        const metaKey = (meta && template.extends?.with) ? transformer
          .getExtendedDataKey(template.extends.with, 'meta.') : null;
        const elementParseDataFn = window[`onElementParseData_${element.id}`];
        const hasElementParseDataFn = typeof elementParseDataFn === 'function';
        const isInData = extendOverrideKey !== null &&
          elData != undefined && elData.hasOwnProperty(extendOverrideKey);
        const isInMeta = metaKey !== null &&
          meta.hasOwnProperty(metaKey);

        if (extendWithDataKey !== null) {
          if (isInData) {
            convertedProperties[extendOverrideKey] =
              (elData) && elData[extendWithDataKey];
          } else if (isInMeta) {
            convertedProperties[extendOverrideKey] = meta[metaKey];
          } else if (extendWithDataKey === 'mediaId') {
            convertedProperties[extendOverrideKey] =
              '[[mediaId=' + element.mediaId + ']]';
          } else {
            convertedProperties[extendOverrideKey] =
              (elData) && elData[extendWithDataKey];
          }
        }

        if (element.elementType === 'dataset' && elData) {
          if (extendOverrideKey !== null) {
            convertedProperties[extendOverrideKey] =
              elData.hasOwnProperty(convertedProperties.datasetField) ?
                elData[convertedProperties.datasetField] : '';
          }
        }

        if (extendWithDataKey !== null || metaKey !== null) {
          if (template.onElementParseData && hasElementParseDataFn && elData) {
            convertedProperties[extendOverrideKey] = elementParseDataFn(
              isInData ?
                elData[extendOverrideKey] :
                isInMeta ?
                  meta[metaKey] :
                  elData[extendWithDataKey],
              convertedProperties,
            );
          }
        }

        if (element.hasDataType &&
          (extendOverrideKey !== null || extendWithDataKey !== null)
        ) {
          // Validate element data
          self.validateElementData(
            element,
            elData,
          );
        }

        // Escape HTML
        convertedProperties.escapeHtml =
          (template?.extends?.escapeHtml === undefined) ?
            true : template.extends.escapeHtml;


        // Compile hbs template with data
        let hbsHtml = hbsTemplate(convertedProperties);

        // Replace 123 with urls for [[assetID=123]] with asset url
        const assetRegex = /\[\[assetId=[\w&\-]+\]\]/gi;

        // Replace [[assetID=123]] with asset url
        hbsHtml.match(assetRegex)?.forEach((match) => {
          const assetId = match.split('[[assetId=')[1].split(']]')[0];
          const assetUrl = assetDownloadUrl.replace(':assetId', assetId);

          // Replace asset id with asset url
          hbsHtml = hbsHtml.replace(match, assetUrl);
        });

        // Replace [[mediaId]] with media URL or element media id
        const mediaURLRegex = /\[\[mediaId=[\w&\-]+\]\]/gi;
        hbsHtml.match(mediaURLRegex)?.forEach((match) => {
          const mediaId = match.split('[[mediaId=')[1].split(']]')[0];
          const mediaUrl =
            urlsForApi.library.download.url.replace(':id', mediaId) +
              '?preview=1';

          // Replace asset id with asset url
          hbsHtml = hbsHtml.replace(match, mediaUrl);
        });

        // Append hbs html to the element
        $elementContainer.find('.element-content').html(hbsHtml);

        // Call on template render if it exists
        if (template.onTemplateRender) {
          const onTemplateRender =
            window['onTemplateRender_' + element.elementId];

          // Call on template render on element creation
          onTemplateRender && onTemplateRender(
            element.elementId,
            $elementContainer.find('.element-content'),
            elData ? elData : [],
            convertedProperties,
            meta,
          );
        }

        // Call callback if it exists
        if (callback) {
          callback();
        }
      });
    });

    // If elements is selected, update bottom bar
    if (element.selected) {
      lD.bottombar.render(element);
    }
  });
};

/**
 * Validate element
 * @param {Object} element
 */
Viewer.prototype.validateElement = function(
  element,
) {
  const $elementContainer =
    this.DOMObject.find(`#${element.elementId}`);
  const $groupContainer =
    $elementContainer.parents('.designer-element-group');
  const hasGroup = Boolean(element.groupId);

  // Check if parent widget is not valid
  const parentWidget = lD.getObjectByTypeAndId(
    'widget',
    'widget_' + element.regionId + '_' + element.widgetId,
    'canvas',
  );

  // Get error message container
  let $messageContainer = (hasGroup) ?
    $groupContainer.find('> .message-container') :
    $elementContainer.find('> .message-container');

  // If there's no message container, add it
  if ($messageContainer.length === 0) {
    $messageContainer = $('<div class="message-container"></div>');

    if (hasGroup) {
      $messageContainer.appendTo($groupContainer);
    } else {
      $messageContainer.appendTo($elementContainer);
    }
  }

  // Get error message
  let $errorMessage = $messageContainer.find('.error-message');

  // Is widget not valid?
  const isNotValid = (
    !$.isEmptyObject(parentWidget.validateData)
  );

  // If parent widget isn't valid, show error message
  if (isNotValid) {
    const errorArray = [];

    // Create message container if it doesn't exist
    if ($errorMessage.length === 0) {
      $errorMessage = $(
        `<div class="error-message d-none" data-html="true">
            <i class="fa fa-exclamation-circle"></i>
        </div>`);

      if (hasGroup) {
        // Remove message from element if we're going to create the group one
        $elementContainer.find('.error-message').remove();
      }

      $errorMessage.appendTo($messageContainer);
    }

    // Request message
    (parentWidget.validateData.errorMessage) &&
      errorArray.push(
        '<p>' +
        parentWidget.validateData.errorMessage +
        '</p>');

    // Sample data message
    (parentWidget.validateData.sampleDataMessage) &&
      errorArray.push(
        '<p class="sample-data">( ' +
        parentWidget.validateData.sampleDataMessage +
        ' )</p>');

    // Set title/tooltip
    $errorMessage.tooltip('dispose')
      .prop('title', '<div class="custom-tooltip">' +
        errorArray.join('') + '</div>');
    $errorMessage.tooltip();

    // Show tooltip
    $errorMessage.removeClass('d-none');
  } else {
    // Remove error message
    $errorMessage.remove();
  }

  // Get warning message ( from element or group )
  let $warningMessage = (hasGroup) ?
    $groupContainer.find('.warning-message') :
    $elementContainer.find('.warning-message');

  // Needs warning message?
  const needsWarningMessage = (
    parentWidget.requiredElements &&
    parentWidget.requiredElements.valid === false
  );

  // Warning message needed
  if (needsWarningMessage) {
    const errorArray = [];

    // Create message container if it doesn't exist
    if ($warningMessage.length === 0) {
      $warningMessage = $(
        `<div class="warning-message d-none" data-html="true">
            <i class="fa fa-warning"></i>
        </div>`);

      if (hasGroup) {
        // Remove message from element if we're going to create the group one
        $elementContainer.find('.warning-message').remove();
      }

      $warningMessage.appendTo($messageContainer);
    }

    // Check required elements
    const requiredElementsErrorMessage =
      parentWidget.checkRequiredElements();

    // Default message
    // show only if we don't have required elements message
    (!requiredElementsErrorMessage) &&
      errorArray.push(
        '<p>' +
        propertiesPanelTrans.invalidWidget +
        '</p>');

    // Required elements message
    (requiredElementsErrorMessage) &&
      errorArray.push(
        '<p>' +
        requiredElementsErrorMessage +
        '</p>');

    // Set title/tooltip
    $warningMessage.tooltip('dispose')
      .prop('title', '<div class="custom-tooltip">' +
        errorArray.join('') + '</div>');
    $warningMessage.tooltip();

    // Show tooltip
    $warningMessage.removeClass('d-none');
  } else {
    // Remove error message
    $warningMessage.remove();
  }
};

/**
 * Validate element data
 * @param {Object} element
 * @param {Object} widgetData
 */
Viewer.prototype.validateElementData = function(
  element,
  widgetData,
) {
  const $elementContainer =
    this.DOMObject.find(`#${element.elementId}`);
  const $groupContainer =
    $elementContainer.parents('.designer-element-group');
  const hasGroup = Boolean(element.groupId);

  // Get error message container
  let $messageContainer = (hasGroup) ?
    $groupContainer.find('> .message-container') :
    $elementContainer.find('> .message-container');

  // If there's no message container, add it
  if ($messageContainer.length === 0) {
    $messageContainer = $('<div class="message-container"></div>');

    if (hasGroup) {
      $messageContainer.appendTo($groupContainer);
    } else {
      $messageContainer.appendTo($elementContainer);
    }
  }

  // Get error message ( from element or group )
  let $message = (hasGroup) ?
    $groupContainer.find('.empty-element-data') :
    $elementContainer.find('.empty-element-data');

  const isNotValid =
    !widgetData || typeof widgetData === 'undefined' || widgetData === '';

  if (isNotValid) {
    const errorArray = [];
    const elementType = element.elementType;

    // Create message if doesn't exist
    if ($message.length === 0) {
      $message = $(
        `<div class="empty-element-data d-none" data-html="true">
          <i class="fa fa-info-circle"></i>
        </div>`);

      if (hasGroup) {
        // Remove message from element if we're going to create the group one
        $elementContainer.find('.empty-element-data').remove();
      }

      $message.appendTo($messageContainer);
    }

    errorArray.push(
      '<p>' +
      elementType.charAt(0).toUpperCase() +
      elementType.substring(1) +
      ' element' +
      '</p>');

    errorArray.push(
      '<p>' +
      layoutEditorTrans.emptyElementData +
      '</p>');

    // Set title/tooltip
    $message.tooltip('dispose')
      .prop('title', '<div class="custom-tooltip">' +
        errorArray.join('') + '</div>');
    $message.tooltip();

    // Show tooltip
    $message.removeClass('d-none');
  } else {
    // Remove message
    $message.remove();
  }
};

/**
 * Play preview
 * @param {object=} dimensions - Preview dimensions
 */
Viewer.prototype.playPreview = function(dimensions) {
  const app = this.parent;

  // Preview request path
  const requestPath = urlsForApi.layout.preview.url
    .replace(':id', app.layout.layoutId);

  // If dimensions aren't set, use main container
  if (!dimensions) {
    dimensions = this.containerObjectDimensions;
  }

  // Compile layout template with data
  const html = viewerLayoutPreview({
    url: requestPath,
    width: dimensions.width,
    height: dimensions.height,
  });

  // Clear temp data
  app.common.clearContainer(this.DOMObject.find('.layout-player'));

  // Append layout html to the main div
  this.DOMObject.find('.layout-player').html(html);

  // Update playing button on bottombar
  app.bottombar.DOMObject.find('#play-btn i')
    .removeClass('fa-play-circle')
    .addClass('fa-stop-circle')
    .attr('title', bottombarTrans.stopPreviewLayout);

  // Add preview class to editor
  app.editorContainer.addClass('preview-playing');

  // Create play overlay
  const $customOverlay = $('.custom-overlay').clone();
  $customOverlay
    .addClass('custom-overlay-preview-playing')
    .on('click', this.stopPreview.bind(this));
  $customOverlay.appendTo(app.editorContainer);

  // Mark as playing
  this.previewPlaying = true;
};

/**
 * Stop preview
 */
Viewer.prototype.stopPreview = function() {
  const app = this.parent;

  // Reload bottombar to original state
  app.bottombar.render(app.selectedObject);

  // Remove preview class from editor
  app.editorContainer.removeClass('preview-playing');

  // Remove overlay
  app.editorContainer.find('.custom-overlay-preview-playing')
    .remove();

  // Reload viewer ( which stops preview )
  this.render(true);
};

/**
 * Toggle fullscreen
 */
Viewer.prototype.toggleFullscreen = function() {
  const app = this.parent;

  // Was preview playing?
  const previewWasPlaying = this.previewPlaying;

  // Is preview playing? Stop preview
  if (previewWasPlaying) {
    this.stopPreview();
  }

  this.DOMObject.parents('#layout-viewer-container').toggleClass('fullscreen');
  app.editorContainer.toggleClass('fullscreen-mode');

  this.fullscreenMode = app.editorContainer.hasClass('fullscreen-mode');

  // Add attribute to body for editor fullscreen to be used by the moveable
  if (this.fullscreenMode) {
    $('body').attr('layout-editor-fs', true);
  } else {
    $('body').removeAttr('layout-editor-fs');
  }

  this.update();

  // Is preview playing? Restart
  if (previewWasPlaying) {
    this.playPreview();
  }
};

/**
 * Initialise moveable
 */
Viewer.prototype.initMoveable = function() {
  const self = this;

  // Create moveable
  this.moveable = new Moveable(document.body, {
    draggable: true,
    resizable: true,
    origin: false,
  });

  // Const save tranformation
  const saveTransformation = function(target) {
    const deltaVal = 1;

    // Apply transformation to the element
    const transformSplit = (target.style.transform).split(/[(),]+/);
    let hasTranslate = false;
    let hasRotate = false;

    // If the transform has translate
    if (target.style.transform.search('translate') != -1) {
      // Set values to style
      target.style.left =
        `${parseFloat(target.style.left) + parseFloat(transformSplit[1])}px`;
      target.style.top =
        `${parseFloat(target.style.top) + parseFloat(transformSplit[2])}px`;

      hasTranslate = true;
    }

    // Reset transform
    if (target.style.transform.search('rotate') != -1) {
      const rotateValue = (hasTranslate) ?
        transformSplit[4] :
        transformSplit[1];

      if (rotateValue != '0deg') {
        hasRotate = true;
      }

      target.style.transform = `rotate(${rotateValue})`;
    } else {
      target.style.transform = '';
    }

    // If snap to borders is active, prevent negative values
    // Or snap to border if <1px delta
    // only works for no rotation
    if (self.moveableOptions.snapToBorders && !hasRotate) {
      let left = Number(target.style.left.split('px')[0]);
      let top = Number(target.style.top.split('px')[0]);
      let width = Number(target.style.width.split('px')[0]);
      let height = Number(target.style.height.split('px')[0]);

      const boundsWidth =
        self.moveable.bounds.right -
        self.moveable.bounds.left;

      const boundsHeight =
        self.moveable.bounds.bottom -
        self.moveable.bounds.top;

      // Width
      // If longer than bound's width
      const distanceToRightBound =
        self.moveable.bounds.right - (left + width);
      if (
        width > boundsWidth
      ) {
        width = boundsWidth;
      } else if (
        left + width > self.moveable.bounds.right ||
        (
          distanceToRightBound != 0 &&
          Math.abs(distanceToRightBound) < deltaVal
        )
      ) {
        // If not longer but passes right bound, adjust left value
        left = left - distanceToRightBound;
      }

      // Left
      if (
        left < self.moveable.bounds.left ||
        Math.abs(left - self.moveable.bounds.left) < deltaVal
      ) {
        left = self.moveable.bounds.left;
      }

      // Height
      // If taller than bounds
      const distanceToBottomBound =
        self.moveable.bounds.bottom - (top + height);
      if (
        height > boundsHeight
      ) {
        height = boundsHeight;
      } else if (
        top + height > self.moveable.bounds.bottom ||
        (
          distanceToBottomBound > 0 &&
          Math.abs(distanceToBottomBound) < deltaVal
        )
      ) {
        // If not taller but passes bottom bound, adjust top value
        top = top - distanceToBottomBound;
      }

      // Top
      if (
        top < self.moveable.bounds.top ||
        Math.abs(top - self.moveable.bounds.top) < deltaVal
      ) {
        top = self.moveable.bounds.top;
      }

      // Set style again
      target.style.left = `${left}px`;
      target.style.top = `${top}px`;
      target.style.width = `${width}px`;
      target.style.height = `${height}px`;
    }

    // Return transform split
    return transformSplit;
  };

  /* draggable */
  this.moveable.on('drag', (e) => {
    // Margin to prevent dragging outside of the container
    const remainingMargin = 20;
    let elLeft = e.left;
    let elTop = e.top;

    // If dragged object is an element inside a group
    // use the group position to get the global position
    if ($(e.target).parents('.designer-element-group').length > 0) {
      const parentPos =
        $(e.target).parents('.designer-element-group').position();
      elLeft = parentPos.left + e.left;
      elTop = parentPos.top + e.top;
    }

    // Update horizontal position
    // if not outside of the container
    if (
      elLeft > -e.width + remainingMargin &&
      elLeft + remainingMargin < this.containerObjectDimensions.width
    ) {
      e.target.style.left = `${e.left}px`;
    }

    // Update vertical position
    // if not outside of the container
    if (
      elTop > -e.height + remainingMargin &&
      elTop + remainingMargin < this.containerObjectDimensions.height
    ) {
      e.target.style.top = `${e.top}px`;
    }

    this.updateActionLine();
  }).on('dragEnd', (e) => {
    if (e.isDrag) {
      // Save transformation
      saveTransformation(e.target);

      // Save region properties
      (
        lD.selectedObject.type == 'region' ||
        lD.selectedObject.type == 'widget'
      ) &&
        self.saveRegionProperties(e.target, {
          hasMoved: true,
        });

      // Save element properties
      // if it's not a group
      (
        lD.selectedObject.type == 'element' &&
        !lD.selectedObject.groupId
      ) &&
        self.saveElementProperties(e.target, true);

      // Save element group properties
      (lD.selectedObject.type == 'element-group') &&
        self.saveElementGroupProperties(e.target);

      // Save element included in a group
      (
        lD.selectedObject.type == 'element' &&
        lD.selectedObject.groupId
      ) &&
      self.saveElementGroupProperties(
        $(e.target).parents('.designer-element-group'),
        true,
        false,
      );
    }
  });

  /* drag group */
  this.moveable.on('dragGroup', (ev) => {
    const remainingMargin = 20;

    ev.events.forEach((e) => {
      let elLeft = e.left;
      let elTop = e.top;

      // If dragged object is an element inside a group
      // use the group position to get the global position
      if ($(e.target).parents('.designer-element-group').length > 0) {
        const parentPos =
          $(e.target).parents('.designer-element-group').position();
        elLeft = parentPos.left + e.left;
        elTop = parentPos.top + e.top;
      }

      // Update horizontal position
      // if not outside of the container
      if (
        elLeft > -e.width + remainingMargin &&
        elLeft + remainingMargin < this.containerObjectDimensions.width
      ) {
        e.target.style.left = `${e.left}px`;
      }

      // Update vertical position
      // if not outside of the container
      if (
        elTop > -e.height + remainingMargin &&
        elTop + remainingMargin < this.containerObjectDimensions.height
      ) {
        e.target.style.top = `${e.top}px`;
      }
    });

    this.updateActionLine();

    // Margin to prevent dragging outside of the container
  }).on('dragGroupEnd', (e) => {
    if (e.isDrag) {
      e.targets.forEach((target) => {
        const targetType = $(target).data('type');

        // Save transformation
        saveTransformation(target);

        // Save region properties
        (
          targetType == 'region' || targetType == 'widget'
        ) &&
          self.saveRegionProperties(target, {
            hasMoved: true,
            justTransform: true,
          });

        // Save element properties
        // if it's not a group
        (
          targetType == 'element' &&
          $(target).parents('.designer-element-group').length === 0
        ) &&
          self.saveElementProperties(target, true);

        // Save element group properties
        (targetType == 'element-group') &&
          self.saveElementGroupProperties(target);

        // Save element included in a group
        (
          targetType == 'element' &&
          $(target).parents('.designer-element-group').length > 0
        ) &&
        self.saveElementGroupProperties(
          $(target).parents('.designer-element-group'),
          true,
          false,
        );
      });
    }
  });

  /* resizable */
  this.moveable.on('resize', (e) => {
    e.target.style.cssText += `width: ${e.width}px; height: ${e.height}px`;
    e.target.style.transform = e.drag.transform;

    // If selected object is a widget, get parent instead
    let selectedObject = (lD.selectedObject.type == 'widget') ?
      lD.selectedObject.parent : lD.selectedObject;

    // If it's an element, we need to get the object from the actual structure
    if (selectedObject.type == 'element') {
      selectedObject =
        lD.getObjectByTypeAndId(
          'element',
          selectedObject.elementId,
          'widget_' + selectedObject.regionId + '_' + selectedObject.widgetId,
        );
    }

    // Update object dimension properties
    selectedObject.transform({
      width: parseFloat(e.width / self.containerObjectDimensions.scale),
      height: parseFloat(e.height / self.containerObjectDimensions.scale),
    }, false);

    // Update target object
    if (selectedObject.type == 'region') {
      // Update region
      self.updateRegionWithThrottle(selectedObject, true);
    } else if (selectedObject.type == 'element') {
      // Update element
      self.updateElementWithThrottle(selectedObject);
    } else if (selectedObject.type == 'element-group') {
      self.updateElementGroupWithThrottle(selectedObject);
    }

    this.updateActionLine();
  }).on('resizeEnd', (e) => {
    // Save transformation
    transformSplit = saveTransformation(e.target);

    // Check if item was not resized
    if (transformSplit.length === 1) {
      return;
    }

    // Check if the region moved when resizing
    const moved = (
      parseFloat(transformSplit[1]) != 0 ||
      parseFloat(transformSplit[2]) != 0
    );

    // Save region properties
    (
      (lD.selectedObject.type == 'region') ||
      (lD.selectedObject.type == 'widget')
    ) &&
      self.saveRegionProperties(e.target, {
        hasMoved: moved,
        hasScaled: true,
      });

    // Save element properties
    (
      lD.selectedObject.type == 'element' &&
      !lD.selectedObject.groupId
    ) && self.saveElementProperties(e.target, moved);

    // Save element included in a group
    (
      lD.selectedObject.type == 'element' &&
      lD.selectedObject.groupId
    ) && self.saveElementGroupProperties(
      $(e.target).parents('.designer-element-group'),
      true,
      false,
    );

    // Save group
    (
      lD.selectedObject.type == 'element-group'
    ) && self.saveElementGroupProperties(
      e.target,
      true,
      true,
    );
  });

  /* rotatable */
  this.moveable.on('rotate', (e) => {
    e.target.style.transform = e.drag.transform;
  }).on('rotateEnd', (e) => {
    // Save transformation
    saveTransformation(e.target);

    // Save element properties
    if (
      lD.selectedObject.type == 'element' &&
      !lD.selectedObject.groupId
    ) {
      // Save element
      self.saveElementProperties(e.target);
    }

    // Save element included in a group
    (
      lD.selectedObject.type == 'element' &&
      lD.selectedObject.groupId
    ) && self.saveElementGroupProperties(
      $(e.target).parents('.designer-element-group'),
      true,
      false,
    );
  });

  // Update moveable options
  this.updateMoveableOptions({
    savePreferences: false,
  });
};

/**
 * Initialise Selecto
 * @param {boolean} groupEditing
 * @param {object} groupContainer
 */
Viewer.prototype.initSelecto = function(groupEditing = false, groupContainer) {
  const self = this;
  const app = this.parent;

  // If we're using interactive mode, don't use selecto
  if (app.interactiveMode || app.interactiveEditWidgetMode) {
    if (this.selecto) {
      this.selecto.destroy();
      this.selecto = null;
    }

    return;
  }

  const container = (groupEditing) ?
    groupContainer[0] :
    lD.viewer.DOMObject[0];

  const dragContainer = (groupEditing) ?
    [
      groupContainer[0],
      lD.viewer.DOMObject.find('.viewer-overlay')[0],
    ] :
    [
      lD.viewer.DOMObject[0],
      lD.viewer.DOMObject.find('.viewer-object.layout')[0],
    ];

  const selectableTargets = (groupEditing) ?
    [
      // Elements in group
      '.designer-element-group .viewer-object-select.editable',
    ] :
    [
      // Elements
      '.designer-region-canvas > ' +
        '.designer-element.viewer-object-select.editable',
      // Regions
      '.designer-region.viewer-object-select.editable',
      // Element groups
      '.designer-element-group.viewer-object-select.editable',
    ];

  // Destroy previous selecto
  if (this.selecto) {
    this.selecto.destroy();
    this.selecto = null;
  }

  this.selecto = new Selecto({
    container: container,
    dragContainer: dragContainer,
    selectableTargets: selectableTargets,
    hitRate: 0,
    selectByClick: false,
    selectFromInside: true,
  });

  this.selecto.on('select', (e) => {
    $(e.added).addClass('selected-temp');
    $(e.removed).removeClass('selected-temp');
  }).on('selectEnd', (e) => {
    const minSelectDistance = 10;
    if (
      // If it's click, don't select (only select on drag end)
      e.isClick ||
      // If the selection is less than minimum distance
      (
        e.rect.width < minSelectDistance &&
        e.rect.height < minSelectDistance
      )
    ) {
      return;
    }

    const $selectedObjs = $(e.afterAdded);
    const multipleSelected = ($selectedObjs.length > 1);

    // Remove all temporary select classes
    self.DOMObject.find('.selected-temp').removeClass('selected-temp');

    if (multipleSelected) {
      // Deselect in editor ( only select on viewer with multiple )
      app.selectObject({
        reloadLayerManager: true,
      });
    } else {
      // If it's a single object, select it in the editor
      app.selectObject({
        target: ($selectedObjs.length === 0) ? null : $selectedObjs,
      });
    }

    // Select on viewer
    lD.viewer.selectObject($selectedObjs, multipleSelected, !groupEditing);
  });
};

/**
 * Save the new position of the region
 * @param {object} region - Region object
 * @param {object} [options] - options
 * @param {boolean=} updateRegion - Update region rendering
 * @param {boolean=} hasMoved - Has region moved
 * @param {boolean=} hasScaled - Has region scaled
 * @param {boolean=} justTransform - Has region scaled
 */
Viewer.prototype.saveRegionProperties = function(
  region,
  {
    updateRegion = true,
    hasMoved = false,
    hasScaled = false,
    justTransform = false,
  } = {},
) {
  const self = this;
  const scale = self.containerObjectDimensions.scale;
  const regionId = $(region).attr('id');
  const transform = {};
  const regionObject = lD.layout.regions[regionId];

  // Only change width/height if region has scaled
  if (hasScaled) {
    transform.width = parseFloat($(region).width() / scale);
    transform.height = parseFloat($(region).height() / scale);
  } else {
    transform.width = regionObject.dimensions.width;
    transform.height = regionObject.dimensions.height;
  }

  // Only change top/left if region has moved
  if (hasMoved) {
    transform.top = parseFloat($(region).position().top / scale);
    transform.left = parseFloat($(region).position().left / scale);
  } else {
    transform.top = regionObject.dimensions.top;
    transform.left = regionObject.dimensions.left;
  }

  // if we just want to transform the region
  if (justTransform) {
    regionObject.transform(transform, true);
  } else if (
    regionId == lD.selectedObject.id ||
    (
      lD.selectedObject.parent &&
      regionId == lD.selectedObject.parent.id
    )
  ) {
    // Update region
    regionObject.transform(transform, false);

    // Update position form values
    lD.propertiesPanel.updatePositionForm(transform);

    // Update rich text editors
    forms.reloadRichTextFields(lD.propertiesPanel.DOMObject);

    // Save region but just the position properties
    // save position form flag only for widget
    lD.propertiesPanel.saveRegion(
      !(regionId == lD.selectedObject.id),
    );
    (updateRegion) &&
      lD.viewer.updateRegion(regionObject);
  }
};

/**
 * Save element properties
 * @param {*} element - Element object
 * @param {*} hasMoved
 * @param {*} save
 */
Viewer.prototype.saveElementProperties = function(
  element,
  hasMoved = false,
  save = true,
) {
  const self = this;
  const scale = self.containerObjectDimensions.scale;

  const $element = $(element);
  const elementId = $element.attr('id');
  const parentWidget = lD.getObjectByTypeAndId(
    'widget',
    'widget_' + $element.data('regionId') + '_' + $element.data('widgetId'),
    'canvas',
  );

  const elementObject = parentWidget.elements[elementId];

  // Save dimensions
  elementObject.width = Math.round($element.width() / scale);
  elementObject.height = Math.round($element.height() / scale);

  // Save rotation
  if (
    $element[0].style.transform.search('rotate') >= 0
  ) {
    const transformSplit = $element[0].style.transform.split(/[(),]+/);
    const rotation = (transformSplit.length == 3) ?
      transformSplit[1] :
      transformSplit[4];

    elementObject.rotation = Number(rotation.split('deg')[0]);
  }

  // Only change top/left if element has moved
  if (hasMoved) {
    const topPosition = Number($element.css('top').split('px')[0]);
    const leftPosition = Number($element.css('left').split('px')[0]);

    elementObject.top = (elementObject.group && elementObject.group.top) ?
      Math.round(topPosition / scale) + elementObject.group.top :
      Math.round(topPosition / scale);
    elementObject.left = (elementObject.group && elementObject.group.left) ?
      Math.round(leftPosition / scale) + elementObject.group.left :
      Math.round(leftPosition / scale);
  }

  // If we're not saving through a group
  // Update position form values
  if (elementObject.selected) {
    lD.propertiesPanel.updatePositionForm({
      top: (elementObject.group) ?
        (elementObject.top - elementObject.group.top) : elementObject.top,
      left: (elementObject.group) ?
        (elementObject.left - elementObject.group.left) : elementObject.left,
      width: elementObject.width,
      height: elementObject.height,
      rotation: elementObject.rotation,
    });
  }

  // Save elements
  if (save) {
    parentWidget.saveElements({
      reloadData: false,
    });
  }
};

/**
 * Save element group properties and recalculate dimensions
 * @param {*} elementGroup
 * @param {boolean} [updateDimensions=false]
 * @param {boolean} [savingGroup=true] - if we are saving the group object
 */
Viewer.prototype.saveElementGroupProperties = function(
  elementGroup,
  updateDimensions = false,
  savingGroup = true,
) {
  const self = this;
  const scale = self.containerObjectDimensions.scale;

  // Get group position
  const $elementGroup = $(elementGroup);
  const groupPosition = {
    top: $elementGroup.position().top,
    left: $elementGroup.position().left,
    width: $elementGroup.width(),
    height: $elementGroup.height(),
  };

  const groupObject = lD.getObjectByTypeAndId(
    'element-group',
    $elementGroup.attr('id'),
    'widget_' + $elementGroup.data('regionId') + '_' +
      $elementGroup.data('widgetId'),
  );

  // Get group elements
  const $groupElements = $elementGroup.find('.designer-element');

  // Update group dimensions
  const updateOffset = {
    width: null,
    height: null,
    top: null,
    left: null,
  };

  if (updateDimensions) {
    // Update group dimensions based on elements
    $groupElements.each(function(_key, el) {
      const elementPosition = $(el).position();
      // First we need to find the top/left position
      // left needs to adjust to the elements more to the left of the group
      if (
        updateOffset.left === null ||
        elementPosition.left < updateOffset.left
      ) {
        updateOffset.left = elementPosition.left;
      }

      // top needs to adjust to the element more to the top
      if (
        updateOffset.top === null ||
        elementPosition.top < updateOffset.top
      ) {
        updateOffset.top = elementPosition.top;
      }
    });

    // Now we need to calculate the width and height
    $groupElements.each(function(_key, el) {
      const $element = $(el);
      const elementPosition = $element.position();
      let elWidth = $element.width();
      let elHeight = $element.height();

      // If the element has rotation, the dimensions need to
      // come from its bounding box ( for that we need to apply CSS rotation )
      const targetTransform = $element[0].style.transform;
      if (targetTransform.search('rotate') != -1) {
        const transformSplit = (targetTransform).split(/[(),]+/);
        const rotateValue = transformSplit[1];

        // Reset transform and give CSS rotation
        $element[0].style.transform = '';
        $element.css('rotate', rotateValue);

        // Assign bounding box values to width and height
        elWidth = $element[0].getBoundingClientRect().width;
        elHeight = $element[0].getBoundingClientRect().height;

        // Revert transform and CSS
        $element.css('rotate', '');
        $element[0].style.transform = targetTransform;
      }

      // Apply position offsets
      elementPosition.top -= updateOffset.top;
      elementPosition.left -= updateOffset.left;

      if (
        updateOffset.width === null ||
        elementPosition.left + elWidth >
        updateOffset.width
      ) {
        updateOffset.width = elementPosition.left + elWidth;
      }

      if (
        updateOffset.height === null ||
        elementPosition.top + elHeight >
        updateOffset.height
      ) {
        updateOffset.height = elementPosition.top + elHeight;
      }
    });

    // Update group element with offset
    groupPosition.top = groupPosition.top + updateOffset.top;
    groupPosition.left = groupPosition.left + updateOffset.left;
    groupPosition.width = updateOffset.width;
    groupPosition.height = updateOffset.height;

    // Also update CSS
    $elementGroup.css(groupPosition);
  }

  // Save scaled group dimensions to the object
  groupObject.top = Math.round(groupPosition.top / scale);
  groupObject.left = Math.round(groupPosition.left / scale);
  groupObject.width = Math.round(groupPosition.width / scale);
  groupObject.height = Math.round(groupPosition.height / scale);

  // Calculate group elements position, but only save on the last element
  $groupElements.each(function(_key, el) {
    // if we're updating the dimensions of the group
    // check if we have offset for position and apply that to all elements
    if (updateDimensions) {
      const topPosition = Number($(el).css('top').split('px')[0]);
      const leftPosition = Number($(el).css('left').split('px')[0]);
      $(el).css({
        top: topPosition - updateOffset.top,
        left: leftPosition - updateOffset.left,
      });
    }

    self.saveElementProperties(
      el,
      true,
      _key == $groupElements.length - 1,
    );
  });

  // Save position for the group object
  if (savingGroup) {
    // Update position form values
    lD.propertiesPanel.updatePositionForm({
      top: groupObject.top,
      left: groupObject.left,
      width: groupObject.width,
      height: groupObject.height,
    });
  }
};

/**
 * Select element
 * @param {object} element - Element object
 * @param {boolean} multiSelect - Select another object
 * @param {boolean} removeEditFromGroup
 * @param {boolean} blockMoveable
 */
Viewer.prototype.selectObject = function(
  element = null,
  multiSelect = false,
  removeEditFromGroup = true,
  blockMoveable = false,
) {
  const self = this;

  // Deselect all elements
  if (!multiSelect) {
    this.DOMObject.find('.selected, .selected-from-layer-manager')
      .removeClass('selected selected-from-layer-manager');

    // Also remove select from layer manager from canvas
    self.DOMObject.find('.designer-region-canvas')
      .removeClass('canvas-element-selected-from-layer-manager');

    // Remove all multi select from layer manager
    self.layerManager.DOMObject.find('.multi-selected')
      .removeClass('multi-selected');
  }

  // Remove all editing from groups
  // if we're not selecting an element from that group
  if (
    removeEditFromGroup &&
  !(
    $(element).hasClass('designer-element') &&
    $(element).parents('.designer-element-group.editing').length > 0
  )) {
    this.DOMObject.find('.designer-element-group.editing')
      .removeClass('editing');
  }

  // Select element if exists
  if (element) {
    $(element).addClass('selected');
  }

  // Update moveable
  this.updateMoveable(true, blockMoveable);

  // Handle context menu on multiselect
  if (multiSelect) {
    $('body')
      .off('contextmenu.group')
      .on(
        'contextmenu.group',
        '.moveable-control-box .moveable-area',
        function(ev) {
          const $selectedElements = self.DOMObject.find('.selected');

          lD.openGroupContextMenu($selectedElements, {
            x: ev.pageX,
            y: ev.pageY,
          });

          // Prevent browser default context menu to open
          return false;
        },
      );
  }
};

/**
 * Update moveable
 * @param {boolean} updateTarget
 * @param {boolean} forceDisable
 */
Viewer.prototype.updateMoveable = function(
  updateTarget = false,
  forceDisable = false,
) {
  // On read only mode, or moveable is not defined
  //  don't update
  if (
    this.moveable === null ||
    this.parent.readOnlyMode
  ) {
    return;
  }

  // Get selected element
  const $selectedObject = this.DOMObject.find('.selected');
  const multipleSelected = ($selectedObject.length > 1);

  // Reset all disabled moveables
  // and add to current if we need to disable it
  this.DOMObject.find('.moveable-disabled')
    .removeClass('moveable-disabled');
  (forceDisable) &&
    $selectedObject.addClass('moveable-disabled');

  // Update moveable if we have a selected element, and is not a drawerWidget
  // If we're selecting a widget with no edit permissions don't update moveable
  if (
    multipleSelected ||
    (
      $selectedObject &&
      $.contains(document, $selectedObject[0]) &&
      !$selectedObject.hasClass('drawerWidget') &&
      $selectedObject.hasClass('editable') &&
      !forceDisable &&
      lD.selectedObject.isEditable
    )
  ) {
    if ($selectedObject.hasClass('designer-element-group')) {
      this.moveable.dragTarget =
        $selectedObject.find('.group-select-overlay')[0];
    } else {
      this.moveable.dragTarget = undefined;
    }

    // Set rotatable
    if (
      !multipleSelected &&
      $selectedObject.data('canRotate')
    ) {
      this.moveable.rotatable = true;
      this.moveable.throttleRotate = 1;
    } else {
      this.moveable.rotatable = false;
    }

    // Update snap to elements targets
    if (
      updateTarget &&
      this.moveableOptions.snapToElements
    ) {
      const elementInGroup = $selectedObject.parent()
        .is('.designer-element-group');
      let $elementsToSnapTo;

      // If element is not in a group, match only with
      // elements outside of a group, groups and regions
      if (!elementInGroup) {
        // Get elements
        $elementsToSnapTo = this.DOMObject.find(
          '.designer-element-group:not(.selected)' +
          ',div:not(".designer-element-group") >' +
            '.designer-element:not(.selected)' +
          ',.designer-region:not(.selected)');
      } else {
        // If element is in a group, match with element
        // in the group and parent group
        $elementsToSnapTo = $.merge(
          $selectedObject.siblings('.designer-element:not(.selected)'),
          $selectedObject.parent('.designer-element-group:not(.selected)'),
        );
      }

      const elementsArray = [];
      Array.from($elementsToSnapTo).forEach(function(el) {
        elementsArray.push(el);
      });
      this.moveable.elementGuidelines = elementsArray;
    }

    // Update target only when needed
    if (updateTarget) {
      if (multipleSelected) {
        this.moveable.target = $selectedObject;
      } else {
        this.moveable.target = $selectedObject[0];

        // Show snap controls
        this.DOMObject.parent().find('.snap-controls').show();

        // Initialise tooltips
        this.parent.common.reloadTooltips(this.DOMObject);
      }
    }

    // Don't resize when selecting multiple items
    if (multipleSelected) {
      this.moveable.resizable = false;

      // Update bottombar with the selected objects
      lD.bottombar.render($selectedObject);
    } else {
      this.moveable.resizable = true;
    }

    // Always update the moveable area
    this.moveable.updateRect();
  } else {
    this.moveable.target = null;

    // Clear rogue moveable elements
    const controlElement = this.moveable.getControlBoxElement();
    $('.moveable-control-box').each((_idx, moveable) => {
      if (!$(moveable).is(controlElement)) {
        $(moveable).remove();
      }
    });

    // Hide snap controls
    this.DOMObject.parent().find('.snap-controls').hide();
  }
};

/**
 * Destroy moveable to avoid memory leaks
 */
Viewer.prototype.destroyMoveable = function() {
  if (this.moveable != null) {
    this.moveable.destroy();
    this.moveable = null;
  }
};

/**
 * Update moveable interface
 */
Viewer.prototype.updateMoveableUI = function() {
  const $snapControls = this.DOMObject.parent().find('.snap-controls');

  // Snap to grid value
  const $gridValue = $snapControls.find('.snap-to-grid-value');
  if (!this.moveableOptions.snapToGrid) {
    // Hide number input
    $gridValue.hide();
  } else {
    // Show number input
    $gridValue.show();

    // Set snap to grid gap
    $gridValue.val(this.moveableOptions.snapGridGap);
  }

  // Snap to grid
  $snapControls.find('#snapToGrid').toggleClass(
    'active',
    this.moveableOptions.snapToGrid,
  );

  // Snap to borders
  $snapControls.find('#snapToBorders').toggleClass(
    'active',
    this.moveableOptions.snapToBorders,
  );

  // Snap to elements
  $snapControls.find('#snapToElements').toggleClass(
    'active',
    this.moveableOptions.snapToElements,
  );
};

/**
 * Update moveable options
 * @param {object} [options] - options
 * @param {boolean=} [options.snapToGrid] - Snap to grid lines
 * @param {boolean=} [options.snapGridGap]
 *  - Snap to grid distance between grid lines
 * @param {boolean=} [options.snapToBorders] - Snap to layout borders
 * @param {boolean=} [options.snapToElements] - Snap to other elements
 * @param {boolean=} [options.savePreferences=true] - Save preferences
 */
Viewer.prototype.updateMoveableOptions = function({
  snapToGrid,
  snapGridGap,
  snapToBorders,
  snapToElements,
  savePreferences = true,
} = {}) {
  const snapThreshold = 5;

  // Snap to grid
  (snapToGrid) &&
    (this.moveableOptions.snapToGrid = snapToGrid);

  // Update grid gap
  (snapGridGap) &&
    (this.moveableOptions.snapGridGap = snapGridGap);

  // Snap to borders
  (snapToBorders) &&
    (this.moveableOptions.snapToBorders = snapToBorders);

  // Snap to elements
  (snapToElements) &&
    (this.moveableOptions.snapToElements = snapToElements);

  // Container scale
  const scale = (this.containerObjectDimensions) ?
    this.containerObjectDimensions.scale : 1;
  const containerWidth = (this.containerObjectDimensions) ?
    this.containerObjectDimensions.width : lD.layout.width;
  const containerHeight = (this.containerObjectDimensions) ?
    this.containerObjectDimensions.height : lD.layout.height;

  // Toggle snap
  if (
    this.moveableOptions.snapToGrid ||
    this.moveableOptions.snapToBorders ||
    this.moveableOptions.snapToElements
  ) {
    this.moveable.snappable = true;
    this.moveable.snapThreshold = snapThreshold;
    this.moveable.snapContainer =
      this.DOMObject.find('.viewer-object.layout')[0];

    this.moveable.snapDirections = {
      top: true,
      left: true,
      bottom: true,
      right: true,
      center: (this.moveableOptions.snapToGrid) ? false : true,
      middle: (this.moveableOptions.snapToGrid) ? false : true,
    };

    this.moveable.elementSnapDirections = {
      top: true,
      left: true,
      bottom: true,
      right: true,
      center: true,
      middle: true,
    };

    this.moveable.snapDistFormat = function(v) {
      return `${Math.round(v/scale)}px`;
    };

    // Snap to middle points
    this.moveable.horizontalGuidelines =
      [{
        pos: containerHeight/2,
        className: 'red',
      }];
    this.moveable.verticalGuidelines =
      [{
        pos: containerWidth/2,
        className: 'red',
      }];
  } else {
    this.moveable.snappable = false;
    this.moveable.snapDirections = null;
    this.moveable.elementSnapDirections = null;
    this.moveable.horizontalGuidelines = [];
    this.moveable.verticalGuidelines = [];
  }

  // Grid snap
  if (this.moveableOptions.snapToGrid) {
    const gridGap = this.moveableOptions.snapGridGap * scale;

    this.moveable.snapGridWidth = gridGap;
    this.moveable.snapGridHeight = gridGap;
    this.moveable.isDisplayGridGuidelines = true;
    this.moveable.horizontalGuidelines = [];
    this.moveable.verticalGuidelines = [];
  } else {
    this.moveable.snapGridWidth = null;
    this.moveable.snapGridHeight = null;
    this.moveable.isDisplayGridGuidelines = false;
  }

  // Border snap
  if (this.moveableOptions.snapToBorders) {
    this.moveable.bounds = {
      left: 0,
      right: containerWidth,
      top: 0,
      bottom: containerHeight,
    };
  } else {
    this.moveable.bounds = null;
  }

  // Snap to elements
  if (this.moveableOptions.snapToElements) {
    // Get elements
    const $elementsToSnapTo =
      this.DOMObject.find(
        '.designer-element:not(.selected), ' +
        '.designer-region:not(.selected), ' +
        '.designer-element-group:not(.selected) ',
      );
    const elementsArray = [];
    Array.from($elementsToSnapTo).forEach(function(el) {
      elementsArray.push(el);
    });

    this.moveable.elementGuidelines = elementsArray;
  } else {
    // Clear guidelines
    this.moveable.elementGuidelines = [];
  }

  // Save snap preferences
  if (savePreferences) {
    this.parent.savePrefs();
  }
};

/**
 * Update region content
 * @param {object} region - Region object
 * @param {boolean} changed - Has region changed
 */
Viewer.prototype.updateRegionContent = function(
  region,
  changed = false,
) {
  const $container = this.DOMObject.find(`#${region.id}`);

  // Update iframe
  const updateIframe = function($iframe) {
    $iframe.css({
      width: region.scaledDimensions.width,
      height: region.scaledDimensions.height,
    });

    // Options for the message
    const options = {
      id: region.id,
      originalWidth: region.dimensions.width,
      originalHeight: region.dimensions.height,
    };

    // Check if it's the first call
    // If it is, send a flag to pause effects on start
    if (!$iframe.data('notFirstCall')) {
      $iframe.data('notFirstCall', true);
      options.pauseEffectOnStart = true;
    }

    // We need to recalculate the scale inside of the iframe
    $iframe[0].contentWindow
      .postMessage({
        method: 'renderContent',
        options: options,
      }, '*');
  };

  // Get iframe
  const $iframe = $container.find('iframe');

  // Check if iframe exists, and is loaded
  if ($iframe.length) {
    // If iframe globalOptions are not loaded
    // wait for the iframe to load
    if (!$iframe[0].contentWindow.window.globalOptions) {
      // Wait for the iframe to load and update it
      $iframe[0].onload = function() {
        $iframe.data('notFirstCall', true);
        updateIframe($iframe);
      };
    } else {
      // Update iframe
      updateIframe($iframe);
    }
  }

  // Process image and video/playlist thumbs
  const $imageContainer = $container
    .find(
      '[data-type="widget_image"], ' +
      '[data-type="widget_video"], ' +
      '[data-type="playlist"]',
    );
  if ($imageContainer.length) {
    const $image = $imageContainer.find('img');

    // If there's no image container, skip
    if ($image.length === 0) {
      return;
    }

    const $imageParent = $image.parent();
    const $imageParentContainer = $image.parents('.img-container');
    const urlSplit = $image.attr('src').split('&proportional=');

    // If the URL is not parsed
    if (urlSplit.length > 1) {
      // Get image properties ( [proportional, fit])
      // Stretch/fill [0,0]
      // Centre/contain [1,0]
      // Fit/cover [1,1]
      const imgValues = urlSplit[1].split('&fit=');
      const objectFit = [
        ['fill', 'none'],
        ['contain', 'cover'],
      ];

      // Get object fit value
      const currentObjectFit = objectFit[imgValues[0]][imgValues[1]];

      // Get object position value
      // if center/contain, get values
      // if others, remove object position value
      const objectPosition = (currentObjectFit === 'contain') ?
        (
          $imageParent.css('text-align') +
          ' ' +
          $imageParent.css('vertical-align')
        ) :
        '';

      // Remove style properties in image's parent
      // They will be applied in the image itself
      $imageParent.css({
        'text-align': '',
        'vertical-align': '',
      });

      // Change only onload
      $image.on('load', () => {
        // Update image fit
        $image.css({
          'object-fit': currentObjectFit,
          'object-position': objectPosition,
        });
      });

      // Change image url to a non styled one
      // Which triggers the onload event
      $image.attr('src', urlSplit[0]);
    }

    // Update image container height
    $imageParentContainer.css({
      height: region.scaledDimensions.height,
    });

    // Update image dimensions
    $image.css({
      width: region.scaledDimensions.width,
      height: region.scaledDimensions.height,
    });

    // If dimensions changed, render region
    if (changed) {
      this.renderRegionDebounced(region);
    }
  }
};

/**
 * Remove object from viewer
 * @param {string} objectType - Object type
 * @param {string} objectId - Object ID
 */
Viewer.prototype.removeObject = function(objectType, objectId) {
  // Remove from DOM
  this.DOMObject
    .find(`[data-type="${objectType}"][data-${objectType}-id="${objectId}"]`)
    .remove();

  // Update moveable
  this.updateMoveable();
};

/**
 * Toggle visibility from object in viewer
 * @param {string} objectType - Object type
 * @param {string} objectId - Object ID
 * @param {boolean} hide - Hide?
 */
Viewer.prototype.toggleObject = function(objectType, objectId, hide) {
  const $viewerObj = this.DOMObject
    .find(`[data-type="${objectType}"][data-${objectType}-id="${objectId}"]`);

  // If hide and it's selected, deselect from viewer
  if (
    hide &&
    $viewerObj.hasClass('selected')
  ) {
    this.selectObject();
  }

  // Remove from DOM
  $viewerObj.toggleClass('d-none', hide);
};

/**
 * Save temporary object
 * @param {string} objectId - Object ID
 * @param {string} objectType - Object type
 * @param {object} data - Object data
 */
Viewer.prototype.saveTemporaryObject = function(objectId, objectType, data) {
  // Remove selected from the viewer
  this.selectObject();

  // Select new object
  lD.selectedObject.id = objectId;
  lD.selectedObject.type = objectType;


  // If it's an element, save also as elementId
  if (lD.selectedObject.type === 'element') {
    lD.selectedObject.elementId = objectId;
  }

  // Append temporary object to the viewer
  $('<div>', {
    id: objectId,
    data: data,
    class: 'viewer-temporary-object',
  }).appendTo(this.DOMObject);
};

Viewer.prototype.editGroup = function(
  groupDOMObject,
  elementToSelectOnLoad = null,
  forceEditOn = false,
) {
  const self = this;
  const editing = $(groupDOMObject).hasClass('editing');

  // Deselect all elements or select specific element
  if (elementToSelectOnLoad) {
    lD.selectObject({
      target: $('#' + elementToSelectOnLoad),
      forceSelect: true,
      refreshEditor: false,
      reloadPropertiesPanel: false,
    });
    self.selectObject('#' + elementToSelectOnLoad);
  } else {
    lD.selectObject();
    self.selectObject();
  }

  // If we're not editing yet, start
  if (!editing || forceEditOn) {
    self.editingGroup = true;

    // Get group object from structure
    const groupId = $(groupDOMObject).attr('id');
    const groupObj = lD.getObjectByTypeAndId(
      'element-group',
      groupId,
      'widget_' +
        $(groupDOMObject).data('regionId') +
        '_' +
        $(groupDOMObject).data('widgetId'),
    );

    // If group isn't expanded, do it and reload layer manager
    if (groupObj.expanded === false) {
      groupObj.expanded = true;
      lD.viewer.layerManager.render();
    }

    // Add editing class
    $(groupDOMObject).addClass('editing');

    // Unset canvas z-index
    self.DOMObject.find('.designer-region-canvas').css('zIndex', '');

    // Add overlay and click to close
    self.DOMObject.find('.viewer-overlay').show()
      .off('click').on('click', () => {
        self.editGroup(groupDOMObject);
      });

    // Bump z-index to show over overlay
    const viewerOverlayIndex =
      self.DOMObject.find('.viewer-overlay').css('z-index');

    // Save original layer to data
    $(groupDOMObject).data('layer', $(groupDOMObject).css('z-index'));
    $(groupDOMObject).css('z-index', Number(viewerOverlayIndex) + 1);

    // Give group the same background as the layout's
    $(groupDOMObject).css('background-color',
      self.DOMObject.find('> .layout').css('background-color'));

    // Change selecto to edit group
    self.initSelecto(true, groupDOMObject);
  } else {
    self.editingGroup = false;

    // Hide overlay
    self.DOMObject.find('.viewer-overlay').hide();

    // Unset canvas z-index
    self.DOMObject.find('.designer-region-canvas')
      .css('zIndex', lD.layout.canvas.zIndex);

    // Unset or reset group z-index
    const originalLayer = $(groupDOMObject).data('layer');
    $(groupDOMObject).css(
      'z-index',
      originalLayer ? originalLayer : '',
    );

    // Remove background color
    $(groupDOMObject).css('background-color', '');

    // Revert selecto to edit global
    self.initSelecto();
  }
};

/**
 * Get multiple selected objects
 * @return {object} Object containing dimensions for the object
 */
Viewer.prototype.getMultipleSelected = function() {
  const $selected = this.DOMObject.find('.selected');
  let canBeDeleted = true;
  let multiple = false;
  if ($selected.length > 1) {
    multiple = true;
    // Check if all selected can be deleted
    $selected.each((_i, obj) => {
      const objData = $(obj).data();
      const objId = $(obj).attr('id');
      const auxObj = (
        objData.type == 'element' ||
        objData.type == 'element-group'
      ) ?
        lD.getObjectByTypeAndId(
          objData.type,
          objId,
          'widget_' + objData.regionId + '_' + objData.widgetId,
        ) :
        lD.getObjectByTypeAndId(objData.type, objId);

      // Can't be deleted, mark flag as false and break loop
      if (auxObj === undefined || auxObj.isDeletable === false) {
        canBeDeleted = false;
        return false;
      }
    });
  }

  return {
    multiple: multiple,
    objects: $selected,
    canBeDeleted: canBeDeleted,
  };
};

/**
 * Inline editing for text element
 * @param {object} textElement - Text Element
 */
Viewer.prototype.editText = function(
  textElement,
) {
  // Get element on viewer
  const $viewerElement =
    this.DOMObject.find('#' + textElement.elementId);
  const $canvas =
    $viewerElement.parents('.designer-region-canvas');
  const $editable =
    $viewerElement.find('.element-content .global-elements-text > div');
  const originalZIndex = $viewerElement.css('z-index');
  const canvasOriginalZIndex = $canvas.css('z-index');
  const editTextZIndex = 2000;

  /**
   * Save on blur method
   */
  function saveOnBlur() {
    // Remove editing class
    $viewerElement.removeClass('inline-editing');

    // Restore z index
    $viewerElement.css('z-index', originalZIndex);
    $canvas.css('z-index', canvasOriginalZIndex);

    // Remove overlay
    lD.editorContainer.find('.custom-overlay-edit-text')
      .remove();

    // Get text and set it for the text field
    const $textArea =
      lD.propertiesPanel.DOMObject.find('textarea[name=text]');

    // Convert HTML to plain text with newlines
    const tempDiv = $('<div>').html($editable.html());
    let plainText = '';

    tempDiv.contents().each(function(_idx, el) {
      if (el.nodeType === 3) {
        // Text node, just add to plain text
        plainText += el.nodeValue;
      } else if (el.nodeType === 1 && el.nodeName === 'DIV') {
        // Element node, type div, need to process line breaks
        const $div = $(el);

        if ($div.html().toLowerCase() === '<br>' || !$div.text().trim()) {
          plainText += '\n';
        } else {
          plainText += $div.text() + '\n';
        }
      }
    });

    // Add text back to text area, remove extra \n if exists
    $textArea.val(
      plainText.endsWith('\n') ?
        plainText.slice(0, -1) : plainText,
    );

    // Save property
    lD.propertiesPanel.saveElement(
      textElement,
      lD.propertiesPanel.DOMObject.find('[name].element-property'),
    );

    // Remove listener
    $editable[0].removeEventListener('blur', saveOnBlur);
  }

  // Convert plain text to HTML to be edited
  const htmlFromText = $editable.html()
    .split('\n')
    .map((line) => `<div>${line || '<br>'}</div>`)
    .join('');

  $editable.html(htmlFromText);

  // Enable editing
  $editable[0].contentEditable = true;

  // Mark element as being edited
  $viewerElement.addClass('inline-editing');

  // Show overlay
  const $customOverlay = $('.custom-overlay').clone();
  $customOverlay.attr('id', 'editTextOverlay')
    .removeClass('custom-overlay')
    .on('click', saveOnBlur)
    .css('z-index', editTextZIndex)
    .addClass('custom-overlay-edit-text');
  $customOverlay.appendTo(lD.editorContainer);

  // Set z-index to viewer element
  $viewerElement.css('z-index', (editTextZIndex + 10));
  $canvas.css('z-index', 'auto');

  // Focus on field ( Fix - after timeout )
  setTimeout(function() {
    $editable[0].focus();
  }, 20);

  // Add blur event handler
  $editable[0].addEventListener('blur', saveOnBlur);
};

/**
 * Toggle loader to viewer object
 * @param {object} target - Target in viewer (element or group )
 * @param {boolean} enable
 */
Viewer.prototype.toggleLoader = function(
  target,
  enable = true,
) {
  const self = this;

  if (enable) {
    const $loader = $(`<div class="loader"></div>`);
    $loader.html(loadingTemplate());

    self.DOMObject.find('#' + target)
      .append($loader);
  } else {
    self.DOMObject.find('#' + target + ' > .loader')
      .remove();
  }
};

/**
 * Handle actions
 */
Viewer.prototype.handleActionsUI = function() {
  const self = this;
  const app = self.parent;

  // Add Layout dock control
  self.DOMObject.append(viewerActionLayoutDockTemplate({
    currentLayoutId: app.mainObjectId,
    currentLayoutName: app.layout.name,
    trans: editorsTrans.actions,
    readOnly: app.readOnlyMode,
  }));

  // Create lines for existing actions
  app.actionManager.getAllActions(app.mainObjectId)
    .then(function(data) {
      // Handle Layout dock
      self.handleLayoutDock(data).then(() => {
        // If there's already an action being edited
        // add it to the data object
        if (
          !$.isEmptyObject(app.actionManager.editing)
        ) {
          const actionId = (app.actionManager.editing.actionId) ?
            app.actionManager.editing.actionId :
            'action_line_temp';
          data[actionId] = app.actionManager.editing;
        }

        if (
          !$.isEmptyObject(data)
        ) {
          Object.entries(data).forEach(([id, action]) => {
            self.addActionLine(
              {
                type: action.source,
                id: action.sourceId,
              },
              {
                type: (action.actionType != 'navLayout') ?
                  action.target : 'screen',
                id: (action.actionType != 'navLayout') ?
                  action.targetId : action.layoutCode,
              },
              id,
            );
          });
        }
      });
    });
};

/**
 * Handle action edit widget
 */
Viewer.prototype.handleActionEditWidgetUI = function() {
  const self = this;
  const app = self.parent;
  const actionData = app.actionManager.editing;
  const actionAreaIndexZIndex = 1040;
  const targetRegion =
    app.getObjectByTypeAndId('region', actionData.targetId);
  const actionAreaIndex = (targetRegion.zIndex + 1 > actionAreaIndexZIndex) ?
    (targetRegion.zIndex + 1) :
    actionAreaIndexZIndex;
  const $layoutContainer = this.DOMObject.find('.viewer-object.layout');

  const createOverlayArea = function(type) {
    self.actionDropMode = true;

    // If target is "screen", use "layout" to highlight
    const targetType =
      (actionData.target === 'screen') ? 'layout' : actionData.target;

    // Create overlay area
    const $actionArea = $(viewerActionEditRegionTemplate({
      drawer: app.layout.drawer,
      target: targetType,
      type: type,
    }));

    // Set background to be the same as the layout
    $actionArea.css({
      'background-color': app.layout.backgroundColor,
    });

    // Update drawer dimensions to match target
    if (targetType === 'region') {
      app.layout.drawer.dimensions = targetRegion.dimensions;
      // Set the z index of the drawer to be over the target region
      app.layout.drawer.zIndex = (actionAreaIndex + 1);
    } else if (targetType === 'layout') {
      app.layout.drawer.dimensions = {
        width: app.layout.width,
        height: app.layout.height,
        top: 0,
        left: 0,
      };
      // Set the z index to 0
      app.layout.drawer.zIndex = 0;
    }

    // Show overlay
    const $customOverlay = $('.custom-overlay').clone();
    $customOverlay
      .addClass('custom-overlay-action-widget-edit')
      .css({
        opacity: 0.6,
        zIndex: actionAreaIndex,
      }).appendTo($layoutContainer);

    $customOverlay.show();

    // Save dimensions to the DOM object
    $actionArea.data('targetRegionDimensions', app.layout.drawer.dimensions);
    $actionArea.data('targetRegionzIndex', app.layout.drawer.zIndex);

    // Add after region or
    // if layout, add inside regions in the layout as first element
    if (targetType === 'region') {
      $actionArea.insertAfter(self.DOMObject.find('#' + targetRegion.id));
    } else if (targetType === 'layout') {
      $layoutContainer.find('#regions').prepend($actionArea);
    }

    return $actionArea;
  };

  // No widget created yet, add overlay and drop zone
  if (!actionData.widgetId) {
    // Create add action area
    const $actionArea = createOverlayArea('create');

    // Add label to action area
    $actionArea.html('<div class="action-label">' +
      viewerTrans.addWidget +
      '</div>');

    const addItem = function(target, draggable) {
      app.dropItemAdd(target, draggable).then((res) => {
        if (res?.id) {
          actionData.widgetId = res.id;
          app.actionManager.editing.widgetId = res.id;

          app.selectedObject.id = 'widget_' +
          app.layout.drawer.regionId + '_' +
            res.id;
          app.selectedObject.type = 'widget';

          // Reload Data, then viewer+PP
          app.reloadData(app.layout, {
            refreshEditor: true,
            reloadViewer: false,
          }).then(() => {
            self.render(true);
          });
        }
      });
    };

    // Click to add widget
    $actionArea.on('click', () => {
      // Card needs to be selected
      if (!$.isEmptyObject(app.toolbar.selectedCard)) {
        addItem($actionArea, app.toolbar.selectedCard);
      }
    });

    // Create droppable area
    $actionArea.droppable({
      greedy: true,
      tolerance: 'pointer',
      accept: function(draggable) {
        // Check target
        return app.common.hasTarget(draggable, 'drawer');
      },
      drop: _.debounce(function(event, ui) {
        addItem(event.target, ui.draggable[0]);
      }, 200),
    });
  } else {
    // Create action edit area
    createOverlayArea('edit');

    // Get widget from drawer be loaded
    const widgetToRender = app.getObjectByTypeAndId(
      'widget',
      'widget_' + app.layout.drawer.regionId + '_' + actionData.widgetId,
      'drawer',
    );

    // Render region with widget
    this.renderRegion(
      app.layout.drawer,
      widgetToRender,
      (actionData.target === 'layout'),
    );
  }

  // Update viewer
  this.update();
};

/**
 * Select action trigger
 * @param {object} trigger - Trigger object, null to deselect only
 */
Viewer.prototype.selectActionTrigger = function(
  trigger = null,
  event,
) {
  const self = this;
  // Check if trigger is frame with widget
  const isFrameWithWidget =
    $(trigger).is('.designer-region[data-sub-type="frame"]') &&
    $(trigger).find('.designer-widget').length > 0;

  // If trigger is a region with widget, select widget instead
  const $trigger = (isFrameWithWidget) ?
    $(trigger).find('.designer-widget') :
    $(trigger);

  // If it's selected already, do nothing
  if ($trigger.hasClass('selected-action-trigger')) {
    return;
  }

  // Deselect other action objects
  this.DOMObject.find('.selected-action-trigger')
    .removeClass('selected-action-trigger trigger-hovering')
    .find('.trigger-add-button').remove();
  this.DOMObject.find('.selected-action-trigger-parent')
    .removeClass('selected-action-trigger-parent');

  // Check if it's one of the layout main containers
  if (
    $trigger.hasClass('layout-wrapper') ||
    $trigger.hasClass('layout-player') ||
    // We skip elements for now
    $trigger.hasClass('designer-element') ||
    $trigger.hasClass('group-select-overlay')
  ) {
    return;
  }

  // Add selected class
  $trigger.addClass('selected-action-trigger');

  // Mark region to disable overlay if needed
  if (isFrameWithWidget) {
    $(trigger).addClass('selected-action-trigger-parent');
  }

  // Add plus button
  const $plusBtn = $(`<div class="trigger-add-button">
    <i class="fa fa-plus-circle"></i></div>`);
  $plusBtn.appendTo($trigger)
    .on('mousedown.viewer', function(ev) {
      ev.preventDefault();

      // Create temporary control for arrow
      self.startCreatingActionLine(
        $trigger,
        {
          x: ev.pageX,
          y: ev.pageY,
        },
      );
    });

  // Handle mouse hover plus position
  const mousePos = {x: event.pageX, y: event.pageY};
  function updateTriggerPosition() {
    // Stop running if not selected and hovering
    if (
      !$trigger.hasClass('selected-action-trigger') ||
      !$trigger.hasClass('trigger-hovering') ||
      $trigger.hasClass('action-screen-helper')
    ) {
      return;
    }

    const offset = $trigger.offset();
    const width = $trigger.outerWidth();
    const height = $trigger.outerHeight();

    // Get mouse relative coordinates
    const relativeX = mousePos.x - offset.left;
    const relativeY = mousePos.y - offset.top;

    // Calculate distances to each side of the element
    const distLeft = relativeX;
    const distRight = width - relativeX;
    const distTop = relativeY;
    const distBottom = height - relativeY;

    // Determine which distance is smallest
    const minDistance = Math.min(distLeft, distRight, distTop, distBottom);
    let closestEdge = '';
    if (minDistance === distTop) {
      closestEdge = 'top';
    } else if (minDistance === distBottom) {
      closestEdge = 'bottom';
    } else if (minDistance === distLeft) {
      closestEdge = 'left';
    } else if (minDistance === distRight) {
      closestEdge = 'right';
    }

    // Save closest edge
    $trigger.attr('data-trigger-pos', closestEdge);

    // Call again in the next animation frame
    requestAnimationFrame(updateTriggerPosition);
  }

  function startTrigger() {
    $trigger.addClass('trigger-hovering');
    $trigger.on('mousemove.edgeDetect', function(e) {
      mousePos.x = e.pageX;
      mousePos.y = e.pageY;
    });

    updateTriggerPosition();
  }

  $trigger.on('mouseenter', function() {
    if (
      $trigger.hasClass('selected-action-trigger') &&
      !$trigger.hasClass('action-screen-helper')
    ) {
      startTrigger();
    }
  }).on('mouseleave', function() {
    if ($trigger.hasClass('selected-action-trigger')) {
      $trigger.removeClass('trigger-hovering');
      $trigger.off('mousemove.edgeDetect');
    }
  }).addClass('trigger-hovering');

  // Start the update loop
  startTrigger();
};

/**
 * Start to create Action Line
 * @param {object} $trigger
 */
Viewer.prototype.startCreatingActionLine = function(
  $trigger,
  startPos = {},
) {
  const self = this;
  const app = self.parent;

  const updateHelperPosition = function($helper, pos) {
    const containerOffset = $helper.parent().offset();
    const helperWidth = $helper.outerWidth();
    const helperHeight = $helper.outerHeight();

    // If there's no container or helper, stop
    if (!containerOffset || !$helper) {
      return;
    }

    $helper.css({
      left: (pos.x - containerOffset.left - helperWidth/2) + 'px',
      top: (pos.y - containerOffset.top - helperHeight/2) + 'px',
    });
  };

  // Make sure trigger is of a valid type
  if ($trigger.data('type') === 'element') {
    // If it's element, check if it's in a group
    if ($trigger.parents('[data-type="element-group"]').length > 0) {
      // In group, change target to group instead
      $trigger = $trigger.parents('[data-type="element-group"]');
    }
  } else if (
    $trigger.hasClass('group-select-overlay')
  ) {
    // Element group
    $trigger = $trigger.parents('[data-type="element-group"]');
  } else if (
    !['screen', 'region', 'widget']
      .includes($trigger.data('type'))
  ) {
    // If it's not in the list of selectable objects, skip
    console.info('not in the list of selectable objects, skip');
    return;
  }

  // If we're editing an action in the form
  // or we're already creating an action
  // STOP
  if (
    !$.isEmptyObject(app.actionManager.editing) ||
    self.creatingAction === true
  ) {
    return;
  }

  self.creatingAction = true;

  // Add extra class to the trigger
  $trigger.addClass('action-trigger-adding');

  // Create target helper
  const $targetHelper =
    $(`<div data-helper-id="addActionTargetHelper" data-type="helper"></div>`)
      .css({
        width: '10px',
        height: '10px',
        position: 'absolute',
        'pointer-events': 'none',
      })
      .appendTo(self.DOMObject);

  const triggerType = $trigger.data('type');
  const triggerId = (['element', 'element-group'].includes(triggerType)) ?
    $trigger.attr('id') :
    $trigger.data(triggerType + 'Id');

  self.addActionLine(
    {
      type: triggerType,
      id: triggerId,
    },
    {
      type: 'helper',
      id: 'addActionTargetHelper',
    },
    'action_line_temp',
  );

  $(document).on('mousemove.addActionLine', function(ev) {
    // If we're not adding the line anymore, stop event
    if (!self.creatingAction || !app.interactiveMode) {
      $(document).off('mousemove.addActionLine');
    }

    // Update helper position
    updateHelperPosition($targetHelper, {
      x: ev.pageX,
      y: ev.pageY,
    });

    // Update action
    self.updateActionLine('action_line_temp');
  });

  // Update helper position - first run
  updateHelperPosition($targetHelper, startPos);
};

/**
 * Stop creating Action Line
 */
Viewer.prototype.stopCreatingActionLine = function(
  removeTriggerSelection = false,
) {
  this.creatingAction = false;

  // Remove event
  $(document).off('mousemove.addActionLine');

  // Remove extra class from selected trigger
  // Add extra class to the trigger
  this.DOMObject.find('.action-trigger-adding')
    .removeClass('action-trigger-adding');

  // Remove trigger selection?
  if (removeTriggerSelection) {
    this.DOMObject.find('.selected-action-trigger')
      .removeClass('selected-action-trigger trigger-hovering')
      .find('.trigger-add-button').remove();
    this.DOMObject.find('.selected-action-trigger-parent')
      .removeClass('selected-action-trigger-parent');
  }

  // Remove helper
  this.DOMObject.find('[data-helper-id="addActionTargetHelper"]')
    .remove();
};

/**
 * Add Action Line
 * @param {object} trigger
 * @param {object} target
 * @param {string} actionId
 * @param {boolean} targetIsDockRecent
 */
Viewer.prototype.addActionLine = function(
  trigger,
  target,
  actionId,
  targetIsDockRecent = false,
) {
  const self = this;
  const app = self.parent;
  const triggerType = (trigger.type === 'layout') ?
    'screen' : trigger.type;

  const $trigger =
    (triggerType == 'element' || triggerType == 'element-group') ?
      this.DOMObject.find('#' + trigger.id) :
      this.DOMObject.find(`[data-type="${triggerType}"]` +
        `[data-${triggerType}-id="${trigger.id}"]`);
  const $target = (target.type == 'element' || target.type == 'element-group') ?
    this.DOMObject.find('#' + target.id) :
    this.DOMObject
      .find(`[data-type="${target.type}"]` +
        `[data-${target.type}-id="${target.id}"]`);

  // Remove line with same action id from the DOM
  // if it exists
  if ($('.leader-line[data-action-id=' + actionId + ']').length > 0) {
    $('.leader-line[data-action-id=' + actionId + ']').remove();
  }

  // If target is a dock recent, and it's not added
  // add it to the dock here
  if (targetIsDockRecent && $target.length === 0 && target.id) {
    self.getLayoutsWithCode({
      code: target.id,
      length: 1,
    }).then((layouts) => {
      const layout = layouts[0];
      // Make sure it's the same layout
      // if so, add to recents
      (target.id === layout.code) &&
        self.addLayoutToRecents({
          code: layout.code,
          name: layout.layout,
        });

      self.addActionLine(
        trigger,
        target,
        actionId,
        targetIsDockRecent,
      );
    });

    return;
  }

  if (
    $trigger.length === 0 ||
    $target.length === 0
  ) {
    const tryAgainDeltaTime = 300;
    const missingTrigger = ($trigger.length === 0);
    const missingTarget = ($target.length === 0);
    let tryAgain = false;

    // Try to get the trigger and target at least once again
    if (
      missingTrigger &&
      trigger.id &&
      trigger.loop != true
    ) {
      trigger.loop = true;
      tryAgain = true;
    }

    if (
      missingTarget &&
      target.id &&
      target.loop != true
    ) {
      target.loop = true;
      tryAgain = true;
    }

    if (tryAgain) {
      (missingTrigger) &&
        console.info(`No Trigger ${trigger.type}: ${trigger.id}`);
      (missingTarget) &&
        console.info(`No Target ${target.type}: ${target.id}`);
      console.info('Trying again!');

      setTimeout(() => {
        self.addActionLine(
          trigger,
          target,
          actionId,
          targetIsDockRecent,
        );
      }, tryAgainDeltaTime);
    } else {
      (missingTrigger && trigger.id) &&
        console.info(`Missing trigger: [data-type="${triggerType}"]` +
        `[data-${triggerType}-id="${trigger.id}"]`);
      (missingTarget && target.id) &&
        console.info(`Missing target: [data-type="${target.type}"]` +
          `[data-${target.type}-id="${target.id}"]`);

      // Remove action line since it's invalid
      self.removeActionLine(actionId);
    }

    return;
  }

  // Create line
  if (
    $trigger[0] === $target[0] ||
    $target.has($trigger).length > 0 ||
    $trigger.has($target).length > 0
  ) {
    this.actionLines[actionId] = {
      line: new LeaderLine(
        LeaderLine.pointAnchor($target[0], lineDef.circularStartPos),
        LeaderLine.pointAnchor($target[0], lineDef.circularEndPos),
        {
          color: (this.theme === 'dark') ?
            lineDef.normalDarkThemeColor :
            lineDef.normalLightThemeColor,
          size: lineDef.normalWidth,
          startPlugSize: lineDef.plugSizeNormal,
          endPlugSize: lineDef.plugSizeNormal,
          startSocket: lineDef.circularStartSocket,
          endSocket: lineDef.circularEndSocket,
          startPlug: 'disc',
          endPlug: 'arrow3',
          path: lineDef.pathCircular,
        },
      ),
      trigger: trigger,
      target: target,
      type: 'circular',
    };
  } else if (
    $trigger.hasClass('action-screen-helper') &&
    $target.hasClass('action-screen-helper')
  ) {
    this.actionLines[actionId] = {
      line: new LeaderLine(
        $trigger[0],
        $target[0],
        {
          color: (this.theme === 'dark') ?
            lineDef.normalDarkThemeColor :
            lineDef.normalLightThemeColor,
          size: lineDef.normalWidth,
          startPlugSize: lineDef.plugSizeNormal,
          endPlugSize: lineDef.plugSizeNormal,
          startSocket: 'top',
          endSocket: 'top',
          path: lineDef.pathDock,
          startSocketGravity:
            lineDef.gravityCircular,
          endSocketGravity:
            lineDef.gravityCircular,
          startPlug: 'disc',
          endPlug: 'arrow3',
          endSocket:
            ($target.hasClass('action-screen-helper')) ? 'top' : 'auto',

        },
      ),
      trigger: trigger,
      target: target,
      type: 'dock',
    };
  } else {
    this.actionLines[actionId] = {
      line: new LeaderLine(
        $trigger[0],
        $target[0],
        {
          color: (this.theme === 'dark') ?
            lineDef.normalDarkThemeColor :
            lineDef.normalLightThemeColor,
          size: lineDef.normalWidth,
          startPlugSize: lineDef.plugSizeNormal,
          endPlugSize: lineDef.plugSizeNormal,
          startPlug: 'disc',
          endPlug: 'arrow3',
          endSocket:
            ($target.hasClass('action-screen-helper')) ? 'top' : 'auto',
        },
      ),
      trigger: trigger,
      target: target,
      type: 'normal',
    };
  }

  // Add classes to trigger and target
  $trigger.addClass('action-trigger');
  $target.addClass('action-target');

  // Add data to line SVG
  const lineID = this.actionLines[actionId].line._id;
  const $lineSVG = $('#leader-line-' + lineID + '-line-path').parents('svg');

  // Handle line events
  $lineSVG.addClass('xibo-editor-action-line')
    .attr('data-action-id', actionId)
    .on('mouseenter', 'path', () => {
      this.actionLines[actionId].line.size =
        lineDef.hoverWidth;
      this.actionLines[actionId].line.startPlugSize =
        lineDef.plugSizeHover;
      this.actionLines[actionId].line.endPlugSize =
        lineDef.plugSizeHover;
    })
    .on('mouseleave', 'path', () => {
      this.actionLines[actionId].line.size =
        lineDef.normalWidth;
      this.actionLines[actionId].line.startPlugSize =
        lineDef.plugSizeNormal;
      this.actionLines[actionId].line.endPlugSize =
        lineDef.plugSizeNormal;
    })
    .on('click', (ev) => {
      const actionData = $(ev.currentTarget).data();

      // Open action on Property Panel
      // only if no action is being edited
      if (
        $.isEmptyObject(app.actionManager.editing) &&
        actionData &&
        actionData.actionId
      ) {
        lD.propertiesPanel.openEditAction(actionData.actionId);
      }
    });

  // If there's a temporary line, and we're not adding it, remove it
  if (
    actionId != 'action_line_temp' &&
    this.actionLines.hasOwnProperty('action_line_temp')
  ) {
    this.removeActionLine('action_line_temp');
  }

  // Update when creating
  this.updateActionLine(actionId);
};

/**
 * Update Action Line
 * @param {string} actionLineId
 */
Viewer.prototype.updateActionLine = function(
  actionLineId,
) {
  const self = this;
  const app = self.parent;
  const isTempAction = (
    !$.isEmptyObject(app.actionManager.editing) &&
    !app.actionManager.editing.actionId ||
    actionLineId === 'action_line_temp'
  );
  const actionBeingEdited = (isTempAction) ?
    'temp_action' : app.actionManager.editing.actionId;

  let actionsToUpdate = [];
  // If we have specific action
  if (actionLineId) {
    // Specific line only
    actionsToUpdate.push(actionLineId);
  } else {
    // All lines
    actionsToUpdate = Object.keys(this.actionLines);
  }

  for (let index = 0; index < actionsToUpdate.length; index++) {
    const lineId = actionsToUpdate[index];
    const isThisActionBeingEdited = (actionBeingEdited === 'temp_action') ?
      ('action_line_temp' === lineId) :
      (actionBeingEdited === Number(lineId));
    const ald = lineDef;

    if (!this.actionLines[lineId]) {
      return;
    }

    // Check if start and end detached from DOM
    // and update those elements if so
    const $detachedStart = $(this.actionLines[lineId].line.start);
    const startId = $detachedStart.attr('id');
    if (
      $detachedStart.closest('html').length == 0 &&
      startId
    ) {
      const $newstart = $('#' + startId);
      try {
        this.actionLines[lineId].line.setOptions({start: $newstart[0]});
      } catch (e) {
        console.warn('LeaderLine setOptions failed:', e);
      }
    }

    const $detachedEnd = $(this.actionLines[lineId].line.end);
    const endId = $detachedEnd.attr('id');
    if (
      $detachedEnd.closest('html').length == 0 &&
      endId
    ) {
      const $newEnd = $('#' + endId);
      try {
        this.actionLines[lineId].line.setOptions({end: $newEnd[0]});
      } catch (e) {
        console.warn('LeaderLine setOptions failed:', e);
      }
    }

    // Set defaults for normal and circular
    if (this.actionLines[lineId].type === 'normal') {
      this.actionLines[lineId].line.path = lineDef.pathNormal;
      this.actionLines[lineId].line.startSocketGravity = lineDef.gravityNormal;
      this.actionLines[lineId].line.endSocketGravity = lineDef.gravityNormal;
    } else if (this.actionLines[lineId].type === 'dock') {
      this.actionLines[lineId].line.path = lineDef.pathDock;
      this.actionLines[lineId].line.startSocketGravity = lineDef.gravityNormal;
      this.actionLines[lineId].line.endSocketGravity = lineDef.gravityNormal;
    } else {
      this.actionLines[lineId].line.startSocketGravity =
        lineDef.gravityCircular;
      this.actionLines[lineId].line.endSocketGravity =
        lineDef.gravityCircular;
    }

    this.actionLines[lineId].line.size = ald.normalWidth;

    // Update position
    try {
      this.actionLines[lineId].line.position();
    } catch (e) {
      console.warn('LeaderLine position failed:', e);
    }

    // Update color
    const normalLineColor = ((this.theme === 'dark') ?
      ald.normalDarkThemeColor : ald.normalLightThemeColor);
    this.actionLines[lineId].line.color = (isThisActionBeingEdited) ?
      ald.editedColor : normalLineColor;

    // If any action is being edited
    // highlight edited and hide others
    if (actionBeingEdited) {
      if (isThisActionBeingEdited) {
        this.actionLines[lineId].line.show();
        this.highlightAction(lineId);
      } else {
        this.actionLines[lineId].line.hide();
      }
    } else {
      // Show all
      this.actionLines[lineId].line.show();
      this.highlightAction();
    }
  }

  // If action id is not specified
  // try to find rogue lines and remove them
  if (!actionLineId) {
    $('.leader-line').each((_idx, line) => {
      const lineId = $(line).data('actionId');
      if (
        actionsToUpdate.indexOf(String(lineId)) === -1
      ) {
        // Remove rogue line
        $(line).remove();
      }
    });
  }
};

/**
 * Update action line targets
 * @param {string} actionLineId
 * @param {object} trigger
 * @param {object} target
 * @param {boolean} targetIsDockRecent
 */
Viewer.prototype.updateActionLineTargets = function(
  actionLineId,
  trigger,
  target,
  targetIsDockRecent = false,
) {
  const self = this;

  // If we're updating temporaty action and it doesn't exist yet
  if (
    actionLineId == 'action_line_temp' &&
    !this.actionLines[actionLineId]
  ) {
    this.addActionLine(trigger, target, actionLineId, targetIsDockRecent);

    return;
  } else if (
    !actionLineId ||
    !this.actionLines[actionLineId]
  ) {
    // If action line doesn't exist
    // or we're passing an empty action line id
    return;
  }

  const triggerType = (trigger.type === 'layout') ?
    'screen' : trigger.type;

  const $trigger =(triggerType == 'element' || triggerType == 'element-group') ?
    this.DOMObject.find('#' + trigger.id) :
    this.DOMObject.find(`[data-type="${triggerType}"]` +
      `[data-${triggerType}-id="${trigger.id}"]`);
  const $target = (target.type == 'element' || target.type == 'element-group') ?
    this.DOMObject.find('#' + target.id) :
    this.DOMObject
      .find(`[data-type="${target.type}"]` +
        `[data-${target.type}-id="${target.id}"]`);

  // If target is a dock recent, and it's not added
  // add it to the dock here
  if (targetIsDockRecent && $target.length === 0 && target.id) {
    self.getLayoutsWithCode({
      code: target.id,
      length: 1,
    }).then((layouts) => {
      const layout = layouts[0];
      // Make sure it's the same layout
      // if so, add to recents
      (target.id === layout.code) &&
        self.addLayoutToRecents({
          code: layout.code,
          name: layout.layout,
        });

      self.updateActionLineTargets(
        actionLineId,
        trigger,
        target,
        targetIsDockRecent,
      );
    });

    return;
  }

  if (
    $trigger.length === 0 ||
    $target.length === 0
  ) {
    // Invalid trigger or target
    // Hide line for now
    this.actionLines[actionLineId].line.hide();
    return;
  } else {
    this.actionLines[actionLineId].line.show();
  }

  this.actionLines[actionLineId].trigger = trigger;
  this.actionLines[actionLineId].target = target;

  // Remove classes from previous trigger/target
  $(this.actionLines[actionLineId].line.start)
    .removeClass('action-trigger');
  $(this.actionLines[actionLineId].line.end)
    .removeClass('action-target');

  // If target is same as trigger, set as circular line
  if (
    $trigger[0] === $target[0] ||
    $target.has($trigger).length > 0 ||
    $trigger.has($target).length > 0
  ) {
    this.actionLines[actionLineId].line.start =
      LeaderLine.pointAnchor($target[0], lineDef.circularStartPos);
    this.actionLines[actionLineId].line.end =
      LeaderLine.pointAnchor($target[0], lineDef.circularEndPos);
    this.actionLines[actionLineId].line.startSocket =
      lineDef.circularStartSocket;
    this.actionLines[actionLineId].line.endSocket =
      lineDef.circularEndSocket;
    this.actionLines[actionLineId].type = 'circular';
    this.actionLines[actionLineId].line.path = lineDef.pathCircular;
    this.actionLines[actionLineId].line.startSocketGravity =
      lineDef.gravityCircular;
    this.actionLines[actionLineId].line.endSocketGravity =
      lineDef.gravityCircular;
  } else if (
    $trigger.hasClass('action-screen-helper') &&
    $target.hasClass('action-screen-helper')
  ) {
    // Trigger and target belong to the layout dock
    this.actionLines[actionLineId].line.start = $trigger[0];
    this.actionLines[actionLineId].line.end = $target[0];
    this.actionLines[actionLineId].line.startSocket = 'top',
    this.actionLines[actionLineId].line.endSocket = 'top',
    this.actionLines[actionLineId].type = 'dock';
    this.actionLines[actionLineId].line.path = lineDef.pathDock;
    this.actionLines[actionLineId].line.startSocketGravity =
      lineDef.gravityCircular;
    this.actionLines[actionLineId].line.endSocketGravity =
      lineDef.gravityCircular;
  } else {
    // Normal line
    this.actionLines[actionLineId].line.start = $trigger[0];
    this.actionLines[actionLineId].line.end = $target[0];
    this.actionLines[actionLineId].line.startSocket = 'auto',
    this.actionLines[actionLineId].line.endSocket =
      ($target.hasClass('action-screen-helper')) ? 'top' : 'auto',
    this.actionLines[actionLineId].type = 'normal';
    this.actionLines[actionLineId].line.path = lineDef.pathNormal;
    this.actionLines[actionLineId].line.startSocketGravity =
      lineDef.gravityNormal;
    this.actionLines[actionLineId].line.endSocketGravity =
      lineDef.gravityNormal;
  }

  // Add classes to trigger and target
  $trigger.addClass('action-trigger');
  $target.addClass('action-target');

  // Update action line
  this.updateActionLine();

  return this.actionLines[actionLineId];
};

/**
 * Remove Action Line
 * @param {string} actionLineId
 */
Viewer.prototype.removeActionLine = function(actionLineId) {
  const self = this;
  const removeLine = function(lineId) {
    // Remove action line if it exists
    if (self.actionLines[lineId]) {
      try {
        // Remove classes from previous trigger/target
        if ($(self.actionLines[actionLineId].line.start).length > 0) {
          $(self.actionLines[actionLineId].line.start)
            .removeClass('action-trigger');
        }

        if ($(self.actionLines[actionLineId].line.end).length > 0) {
          $(self.actionLines[actionLineId].line.end)
            .removeClass('action-target');
        }

        self.actionLines[lineId].line.remove();
      } catch (e) {
        console.warn('Line could not be removed:', e);
      }
      delete self.actionLines[lineId];
    }
  };

  // Make sure we're not creating an action line
  if (self.creatingAction) {
    self.stopCreatingActionLine();
  }

  // Remove specific line
  if (actionLineId) {
    removeLine(actionLineId);
  } else {
    const allLines = Object.keys(this.actionLines);

    for (let index = 0; index < allLines.length; index++) {
      const lineId = allLines[index];
      removeLine(lineId);
    }

    // Remove rogue lines
    $('.leader-line').remove();
  }
};

/**
 * Highlight action on viewer
 * @param {string} actionId
 */
Viewer.prototype.highlightAction = function(
  actionId,
) {
  const self = this;
  const normalLineColor = ((self.theme === 'dark') ?
    lineDef.normalDarkThemeColor : lineDef.normalLightThemeColor);

  // Remove highlight from all the action first
  $('.highlighted-action-object')
    .removeClass('highlighted-action-object');
  for (const key of Object.keys(self.actionLines)) {
    self.actionLines[key].line.color = normalLineColor;
  }

  // Highlight if enable
  if (actionId && this.actionLines[actionId]) {
    this.actionLines[actionId].line.color = lineDef.editedColor;
    $(self.actionLines[actionId].line.start)
      .addClass('highlighted-action-object');
    $(self.actionLines[actionId].line.end)
      .addClass('highlighted-action-object');
  }
};


/**
 * Handle Layout Dock
 * @param {object[]} actions
 * @return {Promise[]} - Promise
 */
Viewer.prototype.handleLayoutDock = function(actions) {
  const self = this;
  const app = self.parent;
  const recentLayouts = new Set();
  const numLayoutsSearch = 10;
  const promiseArray = [];

  const $dockControl =
    self.DOMObject.find('.action-layout-dock-control');
  const $searchButton =
    self.DOMObject.find('.action-layout-dock-search-button');
  const $dockResults =
      self.DOMObject.find('.action-layout-dock-search-results-container');
  const $recentsContainer =
    self.DOMObject.find('.action-layout-dock-recents');

  const populateSearchResultsDebounce = _.debounce(function(search, page = 0) {
    populateSearchResults(search, page);
  }, 200);

  const populateSearchResults = function(search, page = 0) {
    // Empty container if first page
    (page === 0) &&
      $dockResults.find('.action-layout-dock-search-results')
        .empty();

    // Create filter
    const filter = {
      start: page * numLayoutsSearch,
      length: numLayoutsSearch,
    };

    // Add search
    (search) && (filter.code = search);

    // Search for Layouts with code
    self.getLayoutsWithCode(filter).then((layouts) => {
      const $results =
        $dockResults.find('.action-layout-dock-search-results');

      // Filter current layout and layouts added to recents
      layouts = layouts.filter(
        (layout) => {
          return layout.layout != app.layout.name &&
            !($recentsContainer
              .find(
                `.action-screen-recent[data-sub-type="layout-code"]` +
                `[data-screen-id="${layout.code}"]`,
              ).length > 0);
        });

      // If no results, show message
      if (
        layouts.length === 0 &&
        $results.find('.action-layout-dock-option').length === 0
      ) {
        $results.append(`<div class="error-message">
          ${editorsTrans.actions.noResults}</div>`);
      } else {
        $results.find(`.error_message`)
          .remove();
      }

      // Process each layout
      layouts.forEach((layout) => {
        const $option = $(`<div class="action-layout-dock-option"
          data-layout-code="${layout.code}"
          data-layout-name="${layout.layout}">${layout.code}</div>`);

        $option.appendTo($results).on('click', (ev) => {
          const layoutData = $(ev.currentTarget).data();

          self.addLayoutToRecents({
            code: layoutData.layoutCode,
            name: layoutData.layoutName,
          });

          // Hide back the results
          $dockResults.hide();

          // Remove previous results
          $dockResults.find('.action-layout-dock-search-results')
            .empty();

          // Remove custom overlay
          $dockControl.find('.custom-overlay-action-layout-dock-search')
            .remove();
        });
      });

      // Handle lazy load on scroll
      $results.off('scroll').on('scroll', () => {
        if (
          $results.scrollTop() + $results.innerHeight() >=
          $results[0].scrollHeight &&
          layouts.length > 0
        ) {
          populateSearchResultsDebounce(search, ++page);
        }
      });
    });
  };

  // Hide containers by default
  $dockResults.hide();
  $recentsContainer.hide();

  // Check if we have existing actions with Navigate to Layout
  // and add those layouts to recents
  if (actions) {
    Object.values(actions).forEach((action) => {
      if (action.actionType === 'navLayout' && action.layoutCode) {
        recentLayouts.add(String(action.layoutCode));
      }
    });
  }

  // If we have recent layouts on load, add them to list
  if (recentLayouts.size > 0) {
    recentLayouts.forEach((code) => {
      promiseArray.push(new Promise(function(resolve, reject) {
        self.getLayoutsWithCode({
          code: code,
          length: 1,
        }).then((layouts) => {
          const layout = layouts[0];
          // Make sure it's the same layout
          // if so, add to recents
          (code === layout.code) &&
            self.addLayoutToRecents({
              code: layout.code,
              name: layout.layout,
            });

          resolve();
        });
      }));
    });
  }

  // Handle dock control button
  $searchButton.on('click', () => {
    const isOn = $dockResults.is(':visible');
    $dockResults.hide();

    // If it's not showing already
    if (!isOn) {
      $dockResults.find('.action-layout-dock-search-find')
        .on('keyup', (ev) => {
          populateSearchResultsDebounce(ev.currentTarget.value, 0);
        });

      // Show initial results
      populateSearchResults(null, 0);

      // Show the results
      $dockResults.show();

      // Keyboard shortcut event
      $('body').off('keydown.dockSearch')
        .on('keydown.dockSearch', function(handler) {
          // Delete ( Del or Backspace )
          if (handler.key == 'Escape') {
            $searchButton.trigger('click');
          }
        });

      // Show overlay
      const $customOverlay = $('.custom-overlay').clone();
      $customOverlay
        .addClass('custom-overlay-action-layout-dock-search')
        .on('click', function() {
          $searchButton.trigger('click');
        }).css('opacity', 0).appendTo($dockControl).show();
    } else {
      // Remove previous results
      $dockResults.find('.action-layout-dock-search-results')
        .empty();

      // Empty search field
      $dockResults.find('.action-layout-dock-search-find').val('');

      // Remove custom overlay
      $dockControl.find('.custom-overlay-action-layout-dock-search')
        .remove();

      // Remove keyboard shortcut event
      $('body').off('keydown.dockSearch');
    }
  });

  $recentsContainer.off('scroll').on('scroll', () => {
    self.updateActionLine();
  });

  return Promise.all(promiseArray);
};

/**
 * Handle Layout Dock
 * @param {object} filter
 * @return {Promise[]} - Promise
 */
Viewer.prototype.getLayoutsWithCode = function(filter = {}) {
  return new Promise(function(resolve, reject) {
    $.get(urlsForApi.layout.codeSearch.url, filter).done(function(res) {
      if (res.data) {
        resolve(res.data);
      } else {
        reject(new Error('No layouts returned!'));
      }
    });
  });
};

/**
 * Handle Layout Dock
 * @param {object} layoutData
 * @return {Promise[]} - Promise
 */
Viewer.prototype.addLayoutToRecents = function(layoutData) {
  const self = this;
  const $recentsContainer =
    self.DOMObject.find('.action-layout-dock-recents');

  // Check if layout is already added to recents
  if ($recentsContainer
    .find(`[data-screen-id="${layoutData.code}"]`)
    .length === 0
  ) {
    // Add to recents
    const $recent = $(`<div
      class="action-screen-helper action-screen-recent"
      data-type="screen"
      data-sub-type="layout-code"
      data-screen-id="${layoutData.code}"
      title="${layoutData.name}">
      <div class="action-screen-helper-label">
        ${layoutData.code}
      </div>
      <i class="fas fa-close delete-btn"
        title="${editorsTrans.actions.removeFromRecents}"></i>
    </div>`);

    // Append to container
    $recent.appendTo($recentsContainer);

    // Handle remove button
    $recent.on('click', 'i.delete-btn', (ev) => {
      $(ev.currentTarget).parent().remove();

      // Check if it's the last recent, if so, hide container
      ($recentsContainer.find('.action-screen-recent').length === 0) &&
        $recentsContainer.hide();

      self.updateActionLine();
    });

    // Show container
    $recentsContainer.show();
  }
};

module.exports = Viewer;
